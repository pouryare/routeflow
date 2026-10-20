import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-order-kg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { setRate, statementFor } = await import("@/lib/commissionLedger");
const { driverStatementFor, setDriverRate } = await import("@/lib/driverCommissionLedger");
const { orderKgOf, refreshOrderKg, backfillOrderKg } = await import("@/lib/repo/orderKg");
const { lineKg } = await import("@/lib/orderMath");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { group: 0, owner: 0, seller: 0, driver: 0, customer: 0, product: 0, packaging: 0, product2: 0, packaging2: 0 };

type LineRow = Parameters<typeof lineKg>[0];
const referenceKg = (orderId: number): number => {
  const lines = getDb()
    .prepare(
      `SELECT packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit
         FROM order_lines WHERE order_id = ? ORDER BY id`
    )
    .all(orderId) as unknown as LineRow[];
  return lines.reduce((total, line) => total + lineKg(line), 0);
};
const storedKg = (orderId: number) =>
  (getDb().prepare("SELECT kg_total FROM orders WHERE id = ?").get(orderId) as { kg_total: number | null }).kg_total;

/** Sells two products to the customer, runs the order through a real delivery. */
function sellAndDeliver(orderDate: string, delivered: [number, number]): number {
  const db = getDb();
  const order = createOrder(db, {
    customer_id: ctx.customer,
    order_date: orderDate,
    created_by: ctx.owner,
    organization_id: 1,
    salesperson_user_id: ctx.seller,
    lines: [
      { product_id: ctx.product, packaging_id: ctx.packaging, packs: 7 },
      { product_id: ctx.product2, packaging_id: ctx.packaging2, packs: 3 },
    ],
  });
  confirmOrder(db, order.id);
  const run = createRun(db, { driver_user_id: ctx.driver, run_date: orderDate, created_by: ctx.owner, organization_id: 1 });
  const stopId = addStop(db, run, order.id);
  const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
  recordDelivery(db, stopId, {
    lines: stop.lines.map((l, i) => ({ line_id: l.id, packs_delivered: delivered[i] })),
    collected_toman: 0,
    by: ctx.driver,
  });
  return order.id;
}

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  ctx.group = Number(db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES ('شرق','east','#0ff',1,?)").run(now).lastInsertRowid);
  const user = db.prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)");
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.seller = Number(user.run("s", "فروشنده", "phone_sales", ctx.group, now).lastInsertRowid);
  ctx.driver = Number(user.run("d", "راننده", "delivery_driver", ctx.group, now).lastInsertRowid);
  ctx.customer = Number(db.prepare("INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES ('C1','نمونه',?,?)").run(ctx.group, now).lastInsertRowid);
  // Different per-unit weights, so the two lines' kilograms are not round numbers that add exactly.
  ctx.product = createProduct(db, { name: "کره", kg_per_base_unit: 0.37, organization_id: 1 });
  ctx.packaging = createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 13 });
  setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });
  ctx.product2 = createProduct(db, { name: "روغن", kg_per_base_unit: 0.1, organization_id: 1 });
  ctx.packaging2 = createPackaging(db, { product_id: ctx.product2, name: "کارتن", qty_per_pack: 7 });
  setPrice(db, { product_id: ctx.product2, price_toman: 90000, valid_from: "2026-01-01" });
  setRate(db, { rate_per_kg_toman: 2000, valid_from: "2026-01-01", created_by: ctx.owner });
  setDriverRate(db, { rate_per_kg_toman: 500, valid_from: "2026-01-01", created_by: ctx.owner });
});

describe("orders.kg_total", () => {
  it("is stored when an order is created, equal to the sum over its lines", () => {
    const db = getDb();
    const o = createOrder(db, {
      customer_id: ctx.customer, order_date: "2026-03-01", created_by: ctx.owner, organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 7 }, { product_id: ctx.product2, packaging_id: ctx.packaging2, packs: 3 }],
    });
    expect(storedKg(o.id)).toBe(referenceKg(o.id));
    expect(storedKg(o.id)).toBeGreaterThan(0);
  });

  it("is refreshed by a real delivery, to the delivered (not ordered) weight", () => {
    const id = sellAndDeliver("2026-03-02", [5, 1]);
    expect(storedKg(id)).toBe(referenceKg(id));
    // 5 of 7 and 1 of 3 packs, not 7 and 3
    const ordered = referenceKg(sellAndDeliver("2026-03-03", [7, 3]));
    expect(storedKg(id)).toBeLessThan(ordered);
  });

  it("is voided by any change to a line, so a path that forgets to refresh can only be slow, never wrong", () => {
    const id = sellAndDeliver("2026-03-04", [7, 3]);
    const db = getDb();
    expect(storedKg(id)).not.toBeNull();
    db.prepare("UPDATE order_lines SET packs_delivered = 2 WHERE order_id = ? AND id = (SELECT MIN(id) FROM order_lines WHERE order_id = ?)").run(id, id);
    expect(storedKg(id)).toBeNull();

    refreshOrderKg(db, id);
    expect(storedKg(id)).toBe(referenceKg(id));

    db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit, created_at)
       VALUES (?, ?, ?, 1, 1, 1, 5, 0.3, '2026-03-04')`
    ).run(id, ctx.product, ctx.packaging);
    expect(storedKg(id)).toBeNull();

    refreshOrderKg(db, id);
    db.prepare("DELETE FROM order_lines WHERE order_id = ? AND id = (SELECT MAX(id) FROM order_lines WHERE order_id = ?)").run(id, id);
    expect(storedKg(id)).toBeNull();
  });

  it("backfill fills every missing value (a lineless order is zero) and leaves stored ones alone", () => {
    const db = getDb();
    const a = sellAndDeliver("2026-03-05", [4, 2]);
    const empty = Number(
      db.prepare(
        "INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id) VALUES ('EMPTY-1', ?, 'DRAFT', '2026-03-05', ?, 'x', 'x', 1)"
      ).run(ctx.customer, ctx.owner).lastInsertRowid
    );
    db.prepare("UPDATE orders SET kg_total = NULL WHERE id = ?").run(a);
    const kept = sellAndDeliver("2026-03-06", [7, 3]);
    db.prepare("UPDATE orders SET kg_total = 12345.5 WHERE id = ?").run(kept); // sentinel: must not be recomputed

    const filled = backfillOrderKg(db);
    expect(filled).toBeGreaterThanOrEqual(2);
    expect(storedKg(a)).toBe(referenceKg(a));
    expect(storedKg(empty)).toBe(0);
    expect(storedKg(kept)).toBe(12345.5);
    db.prepare("UPDATE orders SET kg_total = ? WHERE id = ?").run(referenceKg(kept), kept);
  });

  it("orderKgOf adds in line order from zero, the same arithmetic the ledgers always used", () => {
    const lines = [0.1, 0.2, 0.3].map((w) => ({ packs_ordered: 1, packs_delivered: null, unit_price_toman: 0, unit_cost_toman: 0, qty_per_pack: 1, kg_per_base_unit: w })) as LineRow[];
    expect(orderKgOf(lines)).toBe(lines.reduce((t, l) => t + lineKg(l), 0));
  });
});

describe("commission statements read the stored weight but never depend on it", () => {
  it("salesperson and driver statements are identical with the weight stored or absent", () => {
    for (const [d, delivered] of [["2026-04-01", [7, 3]], ["2026-04-02", [6, 1]], ["2026-04-03", [2, 0]], ["2026-04-04", [7, 2]]] as const) {
      sellAndDeliver(d, [delivered[0], delivered[1]]);
    }
    const db = getDb();
    const period = { from: "2026-01-01", to: "2026-12-31" };
    const sellerWith = JSON.stringify(statementFor(db, ctx.seller, period));
    const driverWith = JSON.stringify(driverStatementFor(db, ctx.driver, period));
    expect(JSON.parse(sellerWith).orders.length).toBeGreaterThanOrEqual(4);

    db.prepare("UPDATE orders SET kg_total = NULL").run();
    expect(JSON.stringify(statementFor(db, ctx.seller, period))).toBe(sellerWith);
    expect(JSON.stringify(driverStatementFor(db, ctx.driver, period))).toBe(driverWith);

    backfillOrderKg(db);
    expect(JSON.stringify(statementFor(db, ctx.seller, period))).toBe(sellerWith);
    expect(JSON.stringify(driverStatementFor(db, ctx.driver, period))).toBe(driverWith);
  });
});
