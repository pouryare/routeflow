import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPlannableOrders, readPlannedDays } from "@/lib/repo/dayPlan";

const testDbPath = path.join(os.tmpdir(), `rf-day-plan-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { customer: 0, user: 0, product: 0, packaging: 0, orderIds: [] as number[] };
const now = () => new Date().toISOString();

beforeAll(() => {
  const db = getDb();
  const iso = now();
  const org = 1;

  ctx.user = Number(
    db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'delivery_driver', ?)")
      .run(`drv-${process.pid}`, "راننده", iso).lastInsertRowid,
  );
  ctx.customer = Number(
    db.prepare("INSERT INTO customers (customer_code, business_name, lat, lng, synced_at, organization_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(`C-P3-${process.pid}`, "رستوران تست", 35.75, 51.40, iso, org).lastInsertRowid,
  );
  ctx.product = Number(
    db.prepare("INSERT INTO products (name, kg_per_base_unit, volume_m3_per_base_unit, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("کالای تست", 2, 0.25, org, iso, iso).lastInsertRowid,
  );
  ctx.packaging = Number(
    db.prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)")
      .run(ctx.product, "بسته", 6, iso).lastInsertRowid,
  );

  // Three confirmed orders, 10 packs each: 10 x 2 kg x 6 units = 120 kg, 10 x 6 x 0.25 = 15 m3.
  for (let i = 0; i < 3; i++) {
    const oid = Number(
      db.prepare("INSERT INTO orders (order_no, customer_id, order_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, ?, 'CONFIRMED', ?, ?, ?, ?)")
        .run(`P3-${process.pid}-${i}`, ctx.customer, iso.slice(0, 10), ctx.user, org, iso, iso).lastInsertRowid,
    );
    ctx.orderIds.push(oid);
    db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, qty_per_pack, kg_per_base_unit, created_at)
       VALUES (?, ?, ?, 10, 100000, 6, 2, ?)`,
    ).run(oid, ctx.product, ctx.packaging, iso);
  }
});

const SCOPE = { sql: "", params: [] as (number | string)[] };

describe("readPlannableOrders", () => {
  it("derives weight and volume from the frozen line columns", () => {
    const one = readPlannableOrders(getDb(), SCOPE).find((r) => r.orderId === ctx.orderIds[0]);
    expect(one).toBeDefined();
    // 10 packs x 2 kg per base unit x 6 per pack = 120 kg. Read off the LINE, not a stored
    // total, so a later price or packaging edit cannot change what today's van weighs.
    expect(one!.kg).toBeCloseTo(120, 5);
    expect(one!.volumeM3).toBeCloseTo(15, 5);
    // The same figure under the name planDaySplit reads, so nothing translates between shapes.
    expect(one!.weightKg).toBe(one!.kg);
  });

  it("leaves the id a string and carries the numeric orderId alongside it", () => {
    const one = readPlannableOrders(getDb(), SCOPE).find((r) => r.orderId === ctx.orderIds[0])!;
    expect(typeof one.id).toBe("string");
    expect(one.id).toBe(String(one.orderId));
  });

  it("hands a null coordinate through as null, not as a missing key", () => {
    // customers.lat/lng are nullable and planDaySplit refuses to split when one is missing, so
    // the null has to survive the trip or the refusal never triggers.
    const db = getDb();
    const iso = now();
    const noGeo = Number(
      db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES (?, ?, ?, 1)")
        .run(`C-NOGEO-${process.pid}`, "بدون موقعیت", iso).lastInsertRowid,
    );
    const oid = Number(
      db.prepare("INSERT INTO orders (order_no, customer_id, order_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, ?, 'CONFIRMED', ?, 1, ?, ?)")
        .run(`P3-NOGEO-${process.pid}`, noGeo, iso.slice(0, 10), ctx.user, iso, iso).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, qty_per_pack, kg_per_base_unit, created_at)
       VALUES (?, ?, ?, 1, 1000, 6, 2, ?)`,
    ).run(oid, ctx.product, ctx.packaging, iso);

    const row = readPlannableOrders(getDb(), SCOPE).find((r) => r.orderId === oid);
    expect(row).toBeDefined();
    expect(row!.lat).toBeNull();
    expect(row!.lng).toBeNull();
  });

  it("leaves out an order already on a run", () => {
    const db = getDb();
    const iso = now();
    const runId = Number(
      db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, 'planned', ?, 1, ?, ?)")
        .run(ctx.user, "2099-01-01", ctx.user, iso, iso).lastInsertRowid,
    );
    db.prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?, ?, 1, 'pending', ?)")
      .run(runId, ctx.orderIds[0], now());

    const ids = readPlannableOrders(getDb(), SCOPE).map((r) => r.orderId);
    expect(ids).not.toContain(ctx.orderIds[0]);
    expect(ids).toContain(ctx.orderIds[1]);
  });

  it("leaves out an order that is not CONFIRMED", () => {
    const db = getDb();
    db.prepare("UPDATE orders SET status = 'DRAFT' WHERE id = ?").run(ctx.orderIds[1]);
    expect(readPlannableOrders(getDb(), SCOPE).map((r) => r.orderId)).not.toContain(ctx.orderIds[1]);
    db.prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(ctx.orderIds[1]);
  });
describe("readPlannedDays", () => {
  it("returns a future run with its stop count and room left", () => {
    const db = getDb();
    const iso = now();
    const day = "2099-02-02";
    const runId = Number(
      db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, 'planned', ?, 1, ?, ?)")
        .run(ctx.user, day, ctx.user, iso, iso).lastInsertRowid,
    );
    db.prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?, ?, 1, 'pending', ?)")
      .run(runId, ctx.orderIds[2], iso);

    const found = readPlannedDays(db, SCOPE, "2099-01-01", { stops: 8 }).find((d) => d.day === day);
    expect(found).toBeDefined();
    expect(found!.used).toBe(1);
    expect(found!.limit.stops).toBe(8);
  });

  it("prefers the vehicle's own caps over the manager's per-day number", () => {
    const db = getDb();
    const iso = now();
    const vehicleId = Number(
      db.prepare("INSERT INTO vehicles (organization_id, name, max_stops, max_weight_kg, max_volume_m3, created_at, updated_at) VALUES (1, ?, 4, 300, 6, ?, ?)")
        .run(`وانت-${process.pid}`, iso, iso).lastInsertRowid,
    );
    const day = "2099-03-03";
    db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, vehicle_id, created_at, updated_at) VALUES (?, ?, 'planned', ?, 1, ?, ?, ?)")
      .run(ctx.user, day, ctx.user, vehicleId, iso, iso);

    const found = readPlannedDays(db, SCOPE, "2099-01-01", { stops: 8 }).find((d) => d.day === day);
    expect(found!.limit.stops).toBe(4);
    expect(found!.limit.weightKg).toBe(300);
    expect(found!.limit.volumeM3).toBe(6);
  });

  it("excludes a day already in the past, and a finished run", () => {
    const db = getDb();
    const iso = now();
    db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, '2000-01-01', 'planned', ?, 1, ?, ?)")
      .run(ctx.user, ctx.user, iso, iso);
    db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, '2099-04-04', 'done', ?, 1, ?, ?)")
      .run(ctx.user, ctx.user, iso, iso);

    const days = readPlannedDays(db, SCOPE, "2099-01-01", { stops: 8 }).map((d) => d.day);
    expect(days).not.toContain("2000-01-01"); // you cannot add work to last Tuesday
    expect(days).not.toContain("2099-04-04"); // a finished day is not a plan
  });
});
});