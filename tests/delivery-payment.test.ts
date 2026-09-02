import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-delivery-payment-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let customer = 0;
let product = 0;
let packaging = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "DELETE FROM delivery_line_batches; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,NULL,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "م", "owner", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x:y", "ر", "driver", now).lastInsertRowid);
  customer = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x").lastInsertRowid
  );
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: product, price_toman: 10_000, valid_from: "2026-01-01" });
});

/** A confirmed 3-pack order (total 30_000), a run, and its one stop. */
function stagedOrder(): { orderId: number; stopId: number; lineId: number } {
  const db = getDb();
  const order = createOrder(db, {
    customer_id: customer,
    order_date: "2026-08-26",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 3 }],
  });
  confirmOrder(db, order.id);
  const run = createRun(db, {
    driver_user_id: driver,
    run_date: "2026-08-26",
    created_by: owner,
    organization_id: 1,
  });
  const stopId = addStop(db, run, order.id);
  const lineId = readRun(db, run)!.stops.find((s) => s.id === stopId)!.lines[0].id;
  return { orderId: order.id, stopId, lineId };
}

describe("recordDelivery payment", () => {
  it("turns a door collection into a CASH payment allocated to the order", () => {
    const db = getDb();
    const { orderId, stopId, lineId } = stagedOrder();
    recordDelivery(db, stopId, {
      lines: [{ line_id: lineId, packs_delivered: 3 }],
      collected_toman: 25_000,
      by: driver,
    });
    const pay = db.prepare("SELECT * FROM payments WHERE customer_id = ?").get(customer) as {
      id: number;
      method: string;
      amount_toman: number;
      received_by: number;
    };
    expect(pay).toMatchObject({ method: "CASH", amount_toman: 25_000, received_by: driver });
    expect(
      db.prepare("SELECT order_id, amount_toman FROM payment_allocations WHERE payment_id = ?").get(pay.id)
    ).toMatchObject({ order_id: orderId, amount_toman: 25_000 });
    expect(
      db.prepare("SELECT paid_toman, payment_status FROM orders WHERE id = ?").get(orderId)
    ).toMatchObject({ paid_toman: 25_000, payment_status: "partial" });
  });

  it("records nothing when collected_toman is 0", () => {
    const db = getDb();
    const { stopId, lineId } = stagedOrder();
    recordDelivery(db, stopId, {
      lines: [{ line_id: lineId, packs_delivered: 3 }],
      collected_toman: 0,
      by: driver,
    });
    expect(db.prepare("SELECT COUNT(*) n FROM payments").get()).toEqual({ n: 0 });
    expect(
      db.prepare("SELECT payment_status FROM orders WHERE id = (SELECT MAX(id) FROM orders)").get()
    ).toMatchObject({ payment_status: "unpaid" });
  });

  it("puts an over-the-door overpayment on account", () => {
    const db = getDb();
    const { orderId, stopId, lineId } = stagedOrder();
    recordDelivery(db, stopId, {
      lines: [{ line_id: lineId, packs_delivered: 3 }],
      collected_toman: 40_000,
      by: driver,
    });
    const pid = (db.prepare("SELECT id FROM payments").get() as { id: number }).id;
    const allocs = db
      .prepare("SELECT order_id, amount_toman FROM payment_allocations WHERE payment_id = ? ORDER BY id")
      .all(pid);
    expect(allocs).toEqual([
      { order_id: orderId, amount_toman: 30_000 },
      { order_id: null, amount_toman: 10_000 },
    ]);
    expect(
      db.prepare("SELECT payment_status FROM orders WHERE id = ?").get(orderId)
    ).toMatchObject({ payment_status: "paid" });
  });
});
