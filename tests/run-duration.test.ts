import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDbPath = path.join(os.tmpdir(), `rf-rundur-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recordDelivery } = await import("@/lib/delivery");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = (offsetMin = 0) => new Date(Date.now() + offsetMin * 60_000).toISOString();
const ctx: Record<string, number> = { driver: 0, run: 0, customer: 0, n: 0 };

async function readRun(id: number) {
  return await getDb()
    .prepare(
      `SELECT status, started_at, finished_at, actual_duration_min FROM delivery_runs WHERE id = ?`
    )
    .get(id) as {
    status: string;
    started_at: string | null;
    finished_at: string | null;
    actual_duration_min: number | null;
  };
}

/** One order on the run, fully deliverable. */
async function addOrder(): Promise<number> {
  const db = getDb();
  // packagings belongs to a product and carries qty_per_pack -- not kg_per_pack, and no
  // organization_id of its own. Read the DDL rather than guessing: I have guessed wrong on
  // this table's columns twice.
  const product = Number(
    (await db
      .prepare("INSERT INTO products (name, kg_per_base_unit, organization_id, created_at, updated_at) VALUES ('k', 1, 1, ?, ?)")
      .run(iso(), iso())).lastInsertRowid
  );
  const packaging = Number(
    (await db
      .prepare("INSERT INTO packagings (product_id, name, qty_per_pack, active, created_at) VALUES (?, 'p', 1, 1, ?)")
      .run(product, iso())).lastInsertRowid
  );
  const order = Number(
    (await db
      .prepare(
        `INSERT INTO orders (organization_id, customer_id, status, order_no, order_date, created_by, created_at, updated_at)
         VALUES (1, ?, 'CONFIRMED', ?, '2026-11-05', ?, ?, ?)`
      )
      .run(ctx.customer, `RD-${++ctx.n}`, ctx.driver, iso(), iso())).lastInsertRowid
  );
  // order_lines has created_at only -- no updated_at -- and needs kg_per_base_unit too.
  await db.prepare(
    `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, packs_delivered,
                              qty_per_pack, kg_per_base_unit, unit_price_toman, created_at)
     VALUES (?, ?, ?, 1, 0, 1, 1, 1000, ?)`
  ).run(order, product, packaging, iso());
  await db.prepare(
    `INSERT INTO delivery_stops (run_id, order_id, sort_order, status, collected_toman, created_at)
     VALUES (?, ?, ?, 'pending', 0, ?)`
  ).run(ctx.run, order, ctx.n, iso());
  return order;
}

/** Take the next pending stop and record a full delivery at it. */
async function deliverNext(): Promise<void> {
  const db = getDb();
  const stop = await db
    .prepare(`SELECT id FROM delivery_stops WHERE run_id = ? AND status = 'pending' ORDER BY sort_order LIMIT 1`)
    .get(ctx.run) as { id: number } | undefined;
  if (!stop) return;
  const lines = await db
    .prepare("SELECT id, packs_ordered FROM order_lines WHERE order_id = (SELECT order_id FROM delivery_stops WHERE id = ?)")
    .all(stop.id) as unknown as { id: number; packs_ordered: number }[];
  await recordDelivery(db, stop.id, {
    lines: lines.map((l) => ({ line_id: l.id, packs_delivered: l.packs_ordered })),
    collected_toman: 1000,
    by: ctx.driver,
    notes: null,
  });
}

beforeAll(async () => {
  const db = getDb();
  ctx.customer = Number(
    (await db
      .prepare(`INSERT INTO customers (organization_id, customer_code, business_name, synced_at) VALUES (1, 'DR-1', 'مشتری', ?)`)
      .run(iso())).lastInsertRowid
  );
  ctx.driver = Number(
    (await db
      .prepare(
        `INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id)
         VALUES ('dur-driver', 'x:y', 'راننده', 'delivery_driver', NULL, 1, ?, 1)`
      )
      .run(iso())).lastInsertRowid
  );
  ctx.run = Number(
    (await db
      .prepare(
        `INSERT INTO delivery_runs (driver_user_id, group_id, run_date, created_by, created_at, updated_at, organization_id)
         VALUES (?, NULL, '2026-11-05', ?, ?, ?, 1)`
      )
      .run(ctx.driver, ctx.driver, iso(), iso())).lastInsertRowid
  );
  // Started 90 minutes ago, so a run finished now has a real, non-trivial duration.
  await db.prepare("UPDATE delivery_runs SET started_at = ? WHERE id = ?").run(iso(-90), ctx.run);
  await addOrder();
  await addOrder();

  // Phase 1 removed the auto-created warehouse, so a delivery that moves stock now NEEDS a
  // real one. That refusal is CORRECT behaviour being met by a fixture that had been getting
  // away with it -- and it is exactly what this file would have missed otherwise.
  const { recordMovement } = await import("@/lib/repo/stock");
  const { createVanFacility, loadVan } = await import("@/lib/repo/vanStock");
  const warehouse = Number(
    (await db
      .prepare(
        `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, organization_id, created_at, updated_at)
         VALUES ('dur-wh', 'warehouse', 'انبار', 35.5, 51.7, 1, 1, ?, ?)`
      )
      .run(iso(), iso())).lastInsertRowid
  );
  const van = await createVanFacility(1, "وانت تست", `پلاک-تست-${process.pid}`);
  await recordMovement(1, {
    facility_id: warehouse,
    product_id: 1,
    batch_id: null,
    base_qty: 100,
    kind: "PURCHASE_IN",
    occurred_at: iso(),
  });
  for (let i = 1; i <= 4; i++) await loadVan(1, { facilityId: van, productId: 1, qty: 10, actorId: null });
});

describe("a run closes itself when its last stop is answered", () => {
  it("is NOT closed while a stop is still pending", async () => {
    const r = await readRun(ctx.run);
    expect(r.status).not.toBe("done");
  });

  it("closes on the last delivery, and records how long it took", async () => {
    await deliverNext();
    expect((await readRun(ctx.run)).status).not.toBe("done"); // one still pending

    await deliverNext();
    const r = await readRun(ctx.run);
    // THE POINT. Nothing wrote status='done' or actual_duration_min before this, so
    // capacityLearning's WHERE clause could never be satisfied and /sales/forecast has been
    // reading factory defaults. Its own test passes because it inserts the value by hand.
    expect(r.status).toBe("done");
    expect(r.finished_at).not.toBeNull();
    // From started_at, not from midnight: a day beginning at 08:00 is not a 16-hour day.
    expect(r.actual_duration_min).toBeGreaterThan(80);
    expect(r.actual_duration_min).toBeLessThan(100);
  });

  it("does not rewrite the measurement on a later delivery", async () => {
    const before = (await readRun(ctx.run)).actual_duration_min;
    await addOrder();
    await deliverNext(); // a stop added after the day closed
    expect((await readRun(ctx.run)).actual_duration_min).toBe(before);
  });
});