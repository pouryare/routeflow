import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `rf-day-plan-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

/* Imported after ROUTEFLOW_DB_PATH is set: a static import is hoisted above it, and lib/db would
   open data/routeflow.db, the real database. */
const { getDb } = await import("@/lib/db");
const { readPlannableOrders, readPlannedDays } = await import("@/lib/repo/dayPlan");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { customer: 0, user: 0, product: 0, packaging: 0, orderIds: [] as number[] };
const now = () => new Date().toISOString();

beforeAll(async () => {
  const db = getDb();
  const iso = now();
  const org = 1;

  ctx.user = Number(
    (await db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'delivery_driver', ?)")
      .run(`drv-${process.pid}`, "راننده", iso)).lastInsertRowid,
  );
  ctx.customer = Number(
    (await db.prepare("INSERT INTO customers (customer_code, business_name, lat, lng, synced_at, organization_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(`C-P3-${process.pid}`, "رستوران تست", 35.75, 51.40, iso, org)).lastInsertRowid,
  );
  ctx.product = Number(
    (await db.prepare("INSERT INTO products (name, kg_per_base_unit, volume_m3_per_base_unit, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("کالای تست", 2, 0.25, org, iso, iso)).lastInsertRowid,
  );
  ctx.packaging = Number(
    (await db.prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)")
      .run(ctx.product, "بسته", 6, iso)).lastInsertRowid,
  );

  // Three confirmed orders, 10 packs each: 10 x 2 kg x 6 units = 120 kg, 10 x 6 x 0.25 = 15 m3.
  for (let i = 0; i < 3; i++) {
    const oid = Number(
      (await db.prepare("INSERT INTO orders (order_no, customer_id, order_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, ?, 'CONFIRMED', ?, ?, ?, ?)")
        .run(`P3-${process.pid}-${i}`, ctx.customer, iso.slice(0, 10), ctx.user, org, iso, iso)).lastInsertRowid,
    );
    ctx.orderIds.push(oid);
    await db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, qty_per_pack, kg_per_base_unit, created_at)
       VALUES (?, ?, ?, 10, 100000, 6, 2, ?)`,
    ).run(oid, ctx.product, ctx.packaging, iso);
  }
});

const SCOPE = { sql: "", params: [] as (number | string)[] };

describe("readPlannableOrders", () => {
  it("applies the caller's scope: its own organisation sees the order, another sees nothing", async () => {
    const own = await readPlannableOrders(getDb(), { sql: " AND o.organization_id = ?", params: [1] });
    expect(own.map((r) => r.orderId)).toContain(ctx.orderIds[0]);
    const other = await readPlannableOrders(getDb(), { sql: " AND o.organization_id = ?", params: [999] });
    expect(other).toEqual([]);
  });

  it("derives weight and volume from the frozen line columns", async () => {
    const one = (await readPlannableOrders(getDb(), SCOPE)).find((r) => r.orderId === ctx.orderIds[0]);
    expect(one).toBeDefined();
    // 10 packs x 2 kg per base unit x 6 per pack = 120 kg. Read off the LINE, not a stored
    // total, so a later price or packaging edit cannot change what today's van weighs.
    expect(one!.kg).toBeCloseTo(120, 5);
    expect(one!.volumeM3).toBeCloseTo(15, 5);
    // The same figure under the name planDaySplit reads, so nothing translates between shapes.
    expect(one!.weightKg).toBe(one!.kg);
  });

  it("leaves the id a string and carries the numeric orderId alongside it", async () => {
    const one = (await readPlannableOrders(getDb(), SCOPE)).find((r) => r.orderId === ctx.orderIds[0])!;
    expect(typeof one.id).toBe("string");
    expect(one.id).toBe(String(one.orderId));
  });

  it("hands a null coordinate through as null, not as a missing key", async () => {
    // customers.lat/lng are nullable and planDaySplit refuses to split when one is missing, so
    // the null has to survive the trip or the refusal never triggers.
    const db = getDb();
    const iso = now();
    const noGeo = Number(
      (await db.prepare("INSERT INTO customers (customer_code, business_name, synced_at, organization_id) VALUES (?, ?, ?, 1)")
        .run(`C-NOGEO-${process.pid}`, "بدون موقعیت", iso)).lastInsertRowid,
    );
    const oid = Number(
      (await db.prepare("INSERT INTO orders (order_no, customer_id, order_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, ?, 'CONFIRMED', ?, 1, ?, ?)")
        .run(`P3-NOGEO-${process.pid}`, noGeo, iso.slice(0, 10), ctx.user, iso, iso)).lastInsertRowid,
    );
    await db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, qty_per_pack, kg_per_base_unit, created_at)
       VALUES (?, ?, ?, 1, 1000, 6, 2, ?)`,
    ).run(oid, ctx.product, ctx.packaging, iso);

    const row = (await readPlannableOrders(getDb(), SCOPE)).find((r) => r.orderId === oid);
    expect(row).toBeDefined();
    expect(row!.lat).toBeNull();
    expect(row!.lng).toBeNull();
  });

  it("leaves out an order already on a run", async () => {
    const db = getDb();
    const iso = now();
    const runId = Number(
      (await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, 'planned', ?, 1, ?, ?)")
        .run(ctx.user, "2099-01-01", ctx.user, iso, iso)).lastInsertRowid,
    );
    await db.prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?, ?, 1, 'pending', ?)")
      .run(runId, ctx.orderIds[0], now());

    const ids = (await readPlannableOrders(getDb(), SCOPE)).map((r) => r.orderId);
    expect(ids).not.toContain(ctx.orderIds[0]);
    expect(ids).toContain(ctx.orderIds[1]);
  });

  it("leaves out an order that is not CONFIRMED", async () => {
    const db = getDb();
    await db.prepare("UPDATE orders SET status = 'DRAFT' WHERE id = ?").run(ctx.orderIds[1]);
    expect((await readPlannableOrders(getDb(), SCOPE)).map((r) => r.orderId)).not.toContain(ctx.orderIds[1]);
    await db.prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(ctx.orderIds[1]);
  });
});

describe("readPlannedDays", () => {
  it("returns a future run with its stop count and room left", async () => {
    const db = getDb();
    const iso = now();
    const day = "2099-02-02";
    const runId = Number(
      (await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, ?, 'planned', ?, 1, ?, ?)")
        .run(ctx.user, day, ctx.user, iso, iso)).lastInsertRowid,
    );
    await db.prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?, ?, 1, 'pending', ?)")
      .run(runId, ctx.orderIds[2], iso);

    const found = (await readPlannedDays(db, SCOPE, "2099-01-01", { stops: 8 })).find((d) => d.day === day);
    expect(found).toBeDefined();
    expect(found!.used).toBe(1);
    expect(found!.limit.stops).toBe(8);
  });

  it("prefers the vehicle's own caps over the manager's per-day number", async () => {
    const db = getDb();
    const iso = now();
    const vehicleId = Number(
      (await db.prepare("INSERT INTO vehicles (organization_id, name, max_stops, max_weight_kg, max_volume_m3, created_at, updated_at) VALUES (1, ?, 4, 300, 6, ?, ?)")
        .run(`وانت-${process.pid}`, iso, iso)).lastInsertRowid,
    );
    const day = "2099-03-03";
    await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, vehicle_id, created_at, updated_at) VALUES (?, ?, 'planned', ?, 1, ?, ?, ?)")
      .run(ctx.user, day, ctx.user, vehicleId, iso, iso);

    const found = (await readPlannedDays(db, SCOPE, "2099-01-01", { stops: 8 })).find((d) => d.day === day);
    expect(found!.limit.stops).toBe(4);
    expect(found!.limit.weightKg).toBe(300);
    expect(found!.limit.volumeM3).toBe(6);
  });

  it("excludes a day already in the past, and a finished run", async () => {
    const db = getDb();
    const iso = now();
    await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, '2000-01-01', 'planned', ?, 1, ?, ?)")
      .run(ctx.user, ctx.user, iso, iso);
    await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, '2099-04-04', 'done', ?, 1, ?, ?)")
      .run(ctx.user, ctx.user, iso, iso);

    const days = (await readPlannedDays(db, SCOPE, "2099-01-01", { stops: 8 })).map((d) => d.day);
    expect(days).not.toContain("2000-01-01"); // you cannot add work to last Tuesday
    expect(days).not.toContain("2099-04-04"); // a finished day is not a plan
  });
});
describe("a failed delivery puts the order back in the pool", () => {
  it("returns to PLANNED, but its stop still exists -- and that used to hide it", async () => {
    const db = getDb();
    const iso = now();
    const order = Number(
      (await db.prepare(
        `INSERT INTO orders (organization_id, customer_id, status, order_no, order_date, created_by, created_at, updated_at)
         VALUES (1, ?, 'PLANNED', ?, '2026-11-05', ?, ?, ?)`
      ).run(ctx.customer, `RD-F-${process.pid}`, ctx.user, iso, iso)).lastInsertRowid
    );
    await db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, packs_delivered,
                                qty_per_pack, kg_per_base_unit, unit_price_toman, created_at)
       VALUES (?, ?, ?, 2, 0, 1, 1, 500, ?)`
    ).run(order, ctx.product, ctx.packaging, iso);

    // First: put the order on a van as CONFIRMED, the ordinary case. A pending stop means
    // somebody owns it, so it is NOT in the pool.
    await db.prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(order);
    const run = Number(
      (await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, '2026-11-05', 'planned', ?, 1, ?, ?)")
        .run(ctx.user, ctx.user, iso, iso)).lastInsertRowid
    );
    await db.prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?, ?, 0, 'pending', ?)")
      .run(run, order, iso);
    expect((await readPlannableOrders(db, SCOPE)).map((r) => r.orderId)).not.toContain(order);

    // Now the driver went and it FAILED: stop stays 'pending', order goes back to PLANNED.
    await db.prepare("UPDATE orders SET status = 'PLANNED' WHERE id = ?").run(order);

    // The driver went and it failed. NOTE: delivery_stops.status has no 'failed' value --
    // a failed delivery leaves the STOP 'pending' (the driver never got an answer) while
    // the ORDER goes back to PLANNED via retryDelivery. Reading the DDL rather than guessing:
    // I have guessed wrong on this codebase's enums three times now.
    await db.prepare(
      // deliveries: completed_at, not occurred_at. org 1, and a `deliveries` row of its own.
      `INSERT INTO deliveries (order_id, status, completed_at, organization_id, created_at)
       VALUES (?, 'FAILED', ?, 1, ?)`
    ).run(order, iso, iso);

    const row = (await readPlannableOrders(db, SCOPE)).find((r) => r.orderId === order);
    expect(row, "a failed order must be plannable again, without manual rescue").toBeTruthy();
    expect(row!.lastFailedDeliveryId, "so the card can say WHY it needs re-planning").toBeTruthy();
  });

  it("still hides an order somebody is currently on the road with", async () => {
    const db = getDb();
    const iso = now();
    const order = Number(
      (await db.prepare(
        `INSERT INTO orders (organization_id, customer_id, status, order_no, order_date, created_by, created_at, updated_at)
         VALUES (1, ?, 'CONFIRMED', ?, '2026-11-05', ?, ?, ?)`
      ).run(ctx.customer, `RD-P-${process.pid}`, ctx.user, iso, iso)).lastInsertRowid
    );
    await db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, packs_delivered,
                                qty_per_pack, kg_per_base_unit, unit_price_toman, created_at)
       VALUES (?, ?, ?, 1, 0, 1, 1, 500, ?)`
    ).run(order, ctx.product, ctx.packaging, iso);
    const run = Number(
      (await db.prepare("INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, '2026-11-06', 'planned', ?, 1, ?, ?)")
        .run(ctx.user, ctx.user, iso, iso)).lastInsertRowid
    );
    await db.prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?, ?, 0, 'pending', ?)")
      .run(run, order, iso);
    expect((await readPlannableOrders(db, SCOPE)).map((r) => r.orderId)).not.toContain(order);
  });
});
