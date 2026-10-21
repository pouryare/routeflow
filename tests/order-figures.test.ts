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
const { orderKgOf, refreshOrderFigures, backfillOrderFigures } = await import("@/lib/repo/orderFigures");
const { lineKg, lineTotalToman, lineCostToman } = await import("@/lib/orderMath");
const { customerDebtsForOrg } = await import("@/lib/repo/payments");
const { salesDashboard } = await import("@/lib/dashboard");
const { legacyDebtsForOrg } = await import("./helpers/legacyDebts");

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

    refreshOrderFigures(db, id);
    expect(storedKg(id)).toBe(referenceKg(id));

    db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit, created_at)
       VALUES (?, ?, ?, 1, 1, 1, 5, 0.3, '2026-03-04')`
    ).run(id, ctx.product, ctx.packaging);
    expect(storedKg(id)).toBeNull();

    refreshOrderFigures(db, id);
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

    const filled = backfillOrderFigures(db);
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

    backfillOrderFigures(db);
    expect(JSON.stringify(statementFor(db, ctx.seller, period))).toBe(sellerWith);
    expect(JSON.stringify(driverStatementFor(db, ctx.driver, period))).toBe(driverWith);
  });
});

type Figures = { kg_total: number | null; total_toman: number | null; cost_toman: number | null };
const storedFigures = (orderId: number) =>
  getDb().prepare("SELECT kg_total, total_toman, cost_toman FROM orders WHERE id = ?").get(orderId) as Figures;
const referenceTotals = (orderId: number) => {
  const lines = getDb()
    .prepare(
      `SELECT packs_ordered, packs_delivered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit
         FROM order_lines WHERE order_id = ? ORDER BY id`
    )
    .all(orderId) as unknown as LineRow[];
  return {
    total: lines.reduce((t, l) => t + lineTotalToman(l), 0),
    cost: lines.reduce((t, l) => t + lineCostToman(l), 0),
  };
};

describe("orders.total_toman and cost_toman", () => {
  it("are stored when an order is created, and are the sums of the rounded line figures", () => {
    const db = getDb();
    const o = createOrder(db, {
      customer_id: ctx.customer, order_date: "2026-05-01", created_by: ctx.owner, organization_id: 1,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 7 }, { product_id: ctx.product2, packaging_id: ctx.packaging2, packs: 3 }],
    });
    const ref = referenceTotals(o.id);
    expect(storedFigures(o.id)).toEqual({ kg_total: referenceKg(o.id), total_toman: ref.total, cost_toman: ref.cost });
    expect(ref.total).toBeGreaterThan(0);
  });

  it("follow a real delivery to the delivered quantity", () => {
    const id = sellAndDeliver("2026-05-02", [5, 1]);
    const ref = referenceTotals(id);
    expect(storedFigures(id)).toEqual({ kg_total: referenceKg(id), total_toman: ref.total, cost_toman: ref.cost });
    const full = referenceTotals(sellAndDeliver("2026-05-03", [7, 3]));
    expect(ref.total).toBeLessThan(full.total);
  });

  it("are all voided together by a change to a line", () => {
    const id = sellAndDeliver("2026-05-04", [7, 3]);
    const db = getDb();
    expect(storedFigures(id).total_toman).not.toBeNull();
    db.prepare("UPDATE order_lines SET packs_delivered = 1 WHERE order_id = ? AND id = (SELECT MIN(id) FROM order_lines WHERE order_id = ?)").run(id, id);
    expect(storedFigures(id)).toEqual({ kg_total: null, total_toman: null, cost_toman: null });
    refreshOrderFigures(db, id);
    expect(storedFigures(id).total_toman).toBe(referenceTotals(id).total);
  });

  it("backfill fills an order missing any one of the three, and leaves complete ones alone", () => {
    const db = getDb();
    const a = sellAndDeliver("2026-05-05", [4, 2]);
    const b = sellAndDeliver("2026-05-06", [7, 3]);
    db.prepare("UPDATE orders SET cost_toman = NULL WHERE id = ?").run(a); // only one of the three is missing
    db.prepare("UPDATE orders SET total_toman = 777 WHERE id = ?").run(b); // sentinel on a complete order
    expect(backfillOrderFigures(db)).toBeGreaterThanOrEqual(1);
    expect(storedFigures(a).cost_toman).toBe(referenceTotals(a).cost);
    expect(storedFigures(b).total_toman).toBe(777);
    db.prepare("UPDATE orders SET total_toman = ? WHERE id = ?").run(referenceTotals(b).total, b);
  });
});

const approxEqual = (a: unknown, b: unknown, path = ""): string[] => {
  if (typeof a === "number" && typeof b === "number") {
    if (a === b) return [];
    return Number.isInteger(a) && Number.isInteger(b) ? [`${path}: ${a} != ${b}`] : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) ? [] : [`${path}: ${a} != ${b}`];
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? [`${path}: length`] : a.flatMap((x, i) => approxEqual(x, b[i], `${path}[${i}]`));
  if (a && b && typeof a === "object") return [...new Set([...Object.keys(a), ...Object.keys(b as object)])].flatMap((k) => approxEqual((a as never)[k], (b as never)[k], `${path}.${k}`));
  return a === b ? [] : [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
};

describe("readers give the same answer whether the figures are cached or empty", () => {
  const ownerSession = () => {
    const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(ctx.owner) as never;
    return { user, role: "owner", roles: ["owner"], groupId: null, organizationId: 1, hasRole: (r: string) => r === "owner" } as never;
  };

  it("customer debts match the original row-by-row version in both states", () => {
    for (const [d, delivered] of [["2026-06-01", [7, 3]], ["2026-06-02", [6, 1]], ["2026-06-03", [2, 0]], ["2026-06-04", [5, 2]]] as const) {
      sellAndDeliver(d, [delivered[0], delivered[1]]);
    }
    const db = getDb();
    const asOf = "2026-07-01T00:00:00.000Z";
    const want = legacyDebtsForOrg(db, 1, asOf);

    backfillOrderFigures(db); // cached path
    for (const [id, debt] of want) expect({ id, ...customerDebtsForOrg(1, asOf).get(id)! }, `cached ${id}`).toEqual({ id, ...debt });

    db.prepare("UPDATE orders SET kg_total = NULL, total_toman = NULL, cost_toman = NULL").run(); // fallback path
    for (const [id, debt] of want) expect({ id, ...customerDebtsForOrg(1, asOf).get(id)! }, `fallback ${id}`).toEqual({ id, ...debt });
    backfillOrderFigures(db);
  });

  it("the dashboard matches itself in both states (money exactly, kilograms to float noise)", () => {
    const db = getDb();
    backfillOrderFigures(db);
    const cached = salesDashboard(db, ownerSession());
    expect(cached.order_count).toBeGreaterThan(5);
    db.prepare("UPDATE orders SET kg_total = NULL, total_toman = NULL, cost_toman = NULL").run();
    const fallback = salesDashboard(db, ownerSession());
    expect(approxEqual(cached, fallback)).toEqual([]);
    backfillOrderFigures(db);
  });

  it("a lineless order is not counted as a delivered order by the dashboard", () => {
    const db = getDb();
    backfillOrderFigures(db);
    const before = salesDashboard(db, ownerSession()).order_count;
    db.prepare(
      "INSERT INTO orders (order_no, customer_id, status, order_date, delivered_at, created_by, created_at, updated_at, organization_id) VALUES ('NOLINES-1', ?, 'DELIVERED', '2026-06-05', '2026-06-05', ?, 'x', 'x', 1)"
    ).run(ctx.customer, ctx.owner);
    backfillOrderFigures(db); // a lineless order is stored as zero, which must not make it a sale
    expect(salesDashboard(db, ownerSession()).order_count).toBe(before);
  });
});
