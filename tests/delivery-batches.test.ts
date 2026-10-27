import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-delivery-batches-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { recordPurchase, stockPosition } = await import("@/lib/purchases");
const { onHand } = await import("@/lib/repo/stock");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let customer = 0;
let product = 0;
let packaging = 0;

beforeEach(async () => {
  const db = getDb();
  /* The ledger is append-only by trigger and its AR leg REFERENCES customers(id), so
     `DELETE FROM customers` below raises FOREIGN KEY constraint failed once any test in
     this file has recorded a payment. Children before parents -- see
     tests/helpers/ledgerTeardown.ts, and note the scope warning in it: many suites do not
     set ROUTEFLOW_DB_PATH, so this must stay an explicit per-suite call and never a global
     setupFiles hook, which would run against the real data/routeflow.db. */
  await clearLedger(db);

  await db.exec(
    "PRAGMA foreign_keys = OFF; DELETE FROM activities; DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM deliveries; DELETE FROM delivery_lines; DELETE FROM delivery_line_batches; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM purchase_lines; DELETE FROM purchases; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0; PRAGMA foreign_keys = ON;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,NULL,1,?,1)"
  );
  owner = Number((await u.run(`o${Date.now()}`, "x:y", "م", "owner", now)).lastInsertRowid);
  driver = Number((await u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now)).lastInsertRowid);
  customer = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x")).lastInsertRowid
  );
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, price_toman: 5_000, valid_from: "2026-01-01" });

  // Two batches: an earlier expiry with less stock, a later expiry with more.
  await recordPurchase(db, {
    purchase_date: "2026-01-05",
    created_by: owner,
    organization_id: 1,
    lines: [
      { product_id: product, base_qty: 15, unit_cost_toman: 1000, batch_code: "OLD", expiry_date: "2026-02-01" },
      { product_id: product, base_qty: 100, unit_cost_toman: 1000, batch_code: "NEW", expiry_date: "2026-06-01" },
    ],
  });
});

async function stagedOrder(packs: number): Promise<{ stopId: number; lineId: number }> {
  const db = getDb();
  const order = await createOrder(db, {
    customer_id: customer,
    order_date: "2026-01-20",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs }],
  });
  await confirmOrder(db, order.id);
  const run = await createRun(db, {
    driver_user_id: driver,
    run_date: `2026-01-2${Math.floor(Math.random() * 9)}`,
    created_by: owner,
    organization_id: 1,
  });
  const stopId = await addStop(db, run, order.id);
  const lineId = (await readRun(db, run))!.stops.find((s) => s.id === stopId)!.lines[0].id;
  return { stopId, lineId };
}

describe("recordDelivery FEFO stock", () => {
  it("draws the earliest-expiry batch first and records delivery_line_batches", async () => {
    const db = getDb();
    const { stopId, lineId } = await stagedOrder(2); // 2 packs * 10 = 20 base units
    await recordDelivery(db, stopId, {
      lines: [{ line_id: lineId, packs_delivered: 2 }],
      collected_toman: 0,
      by: driver,
    });

    const moves = await db
      .prepare(
        "SELECT b.batch_code, m.base_qty FROM stock_movements m JOIN batches b ON b.id = m.batch_id WHERE m.kind='DELIVERY_OUT' ORDER BY b.expiry_date"
      )
      .all() as { batch_code: string; base_qty: number }[];
    expect(moves).toEqual([
      { batch_code: "OLD", base_qty: -15 },
      { batch_code: "NEW", base_qty: -5 },
    ]);

    const dlb = await db
      .prepare(
        "SELECT b.batch_code, d.base_qty FROM delivery_line_batches d JOIN batches b ON b.id = d.batch_id WHERE d.delivery_stop_id=? ORDER BY b.expiry_date"
      )
      .all(stopId) as { batch_code: string; base_qty: number }[];
    expect(dlb).toEqual([
      { batch_code: "OLD", base_qty: 15 },
      { batch_code: "NEW", base_qty: 5 },
    ]);

    expect(await onHand(1, { product_id: product })).toBe(95); // 115 - 20
  });

  it("converges on a retried delivery -- no doubled movements", async () => {
    const db = getDb();
    const { stopId, lineId } = await stagedOrder(3); // 30 units
    const input = { lines: [{ line_id: lineId, packs_delivered: 3 }], collected_toman: 0, by: driver };
    await recordDelivery(db, stopId, input);
    await recordDelivery(db, stopId, input); // retry

    const outQty = (
      await db
        .prepare("SELECT COALESCE(SUM(base_qty),0) n FROM stock_movements WHERE kind='DELIVERY_OUT'")
        .get() as { n: number }
    ).n;
    expect(outQty).toBe(-30);
    expect(
      (await db.prepare("SELECT COUNT(*) n FROM delivery_line_batches WHERE delivery_stop_id=?").get(stopId) as { n: number }).n
    ).toBeGreaterThan(0);
    expect(await onHand(1, { product_id: product })).toBe(85); // 115 - 30, once
  });

  it("keeps stockPosition on-hand matching the legacy purchased - delivered", async () => {
    const db = getDb();
    const { stopId, lineId } = await stagedOrder(4); // 40 units
    await recordDelivery(db, stopId, {
      lines: [{ line_id: lineId, packs_delivered: 4 }],
      collected_toman: 0,
      by: driver,
    });
    const pos = (await stockPosition(db, 1)).find((r) => r.product_id === product)!;
    expect(pos.on_hand).toBe(75); // 115 purchased - 40 delivered
    expect(await onHand(1, { product_id: product })).toBe(75);
  });
});
