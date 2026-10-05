import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-drvledger-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { setRate } = await import("@/lib/commissionLedger");
const { setDriverRate, recordDriverPayment, driverStatementFor, allDriverStatements } = await import(
  "@/lib/driverCommissionLedger"
);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  east: 0,
  west: 0,
  owner: 0,
  seller: 0,
  eastDriver: 0,
  westDriver: 0,
  customer: 0,
  product: 0,
  packaging: 0,
};

/** Confirms an order credited to the shared فروشنده and delivers it on the given
 *  driver's run for that day -- the driver ledger does not care who sold it. */
function deliverFor(driverId: number, packs: number, orderDate: string): number {
  const db = getDb();
  const order = createOrder(db, {
    customer_id: ctx.customer,
    order_date: orderDate,
    created_by: ctx.owner,
    organization_id: 1,
    salesperson_user_id: ctx.seller,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs }],
  });
  confirmOrder(db, order.id);

  const run = createRun(db, { driver_user_id: driverId, run_date: orderDate, created_by: ctx.owner, organization_id: 1 });
  const stopId = addStop(db, run, order.id);
  const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
  recordDelivery(db, stopId, {
    lines: stop.lines.map((l) => ({ line_id: l.id, packs_delivered: packs })),
    collected_toman: 0,
    by: driverId,
  });
  return order.id;
}

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();

  const group = db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)"
  );
  ctx.east = Number(group.run("شرق", "east", "#0ff", now).lastInsertRowid);
  ctx.west = Number(group.run("غرب", "west", "#f0f", now).lastInsertRowid);

  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)"
  );
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.seller = Number(user.run("s", "فروشنده", "phone_sales", ctx.east, now).lastInsertRowid);
  ctx.eastDriver = Number(user.run("de", "راننده شرق", "delivery_driver", ctx.east, now).lastInsertRowid);
  ctx.westDriver = Number(user.run("dw", "راننده غرب", "delivery_driver", ctx.west, now).lastInsertRowid);

  ctx.customer = Number(
    db
      .prepare("INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)")
      .run("C1", "رستوران نمونه", ctx.east, now).lastInsertRowid
  );

  ctx.product = createProduct(db, { name: "ماست", kg_per_base_unit: 0.5, organization_id: 1 });
  ctx.packaging = createPackaging(db, { product_id: ctx.product, name: "کارتن", qty_per_pack: 20 });
  setPrice(db, { product_id: ctx.product, price_toman: 220000, valid_from: "2026-01-01" });

  // A فروشنده rate too, deliberately different from the driver's -- so a test that
  // accidentally reads the wrong table shows up as a wrong number, not a coincidence.
  setRate(db, { rate_per_kg_toman: 999, valid_from: "2026-01-01", created_by: ctx.owner });
  setDriverRate(db, { rate_per_kg_toman: 500, valid_from: "2026-01-01", created_by: ctx.owner });
});

describe("driverStatementFor", () => {
  it("accrues on what the driver's own run delivered", () => {
    // 2 packs x 20 x 0.5kg = 20kg, at 500 = 10,000 تومان
    deliverFor(ctx.eastDriver, 2, "2026-05-10");
    const s = driverStatementFor(getDb(), ctx.eastDriver, { from: "2026-05-01", to: "2026-05-31" });
    expect(s.kg).toBe(20);
    expect(s.accrued_toman).toBe(10000);
  });

  it("uses a personal rate once it starts, and the default before", () => {
    const db = getDb();
    setDriverRate(db, {
      driver_user_id: ctx.eastDriver,
      rate_per_kg_toman: 800,
      valid_from: "2026-06-01",
      created_by: ctx.owner,
    });

    deliverFor(ctx.eastDriver, 2, "2026-06-10");
    const june = driverStatementFor(db, ctx.eastDriver, { from: "2026-06-01", to: "2026-06-30" });
    expect(june.accrued_toman).toBe(16000); // 20kg x 800

    const may = driverStatementFor(db, ctx.eastDriver, { from: "2026-05-01", to: "2026-05-31" });
    expect(may.accrued_toman).toBe(10000); // unaffected by the later rate
  });

  it("credits the driver who ran the round, not whoever sold it", () => {
    // Both stops are the same فروشنده's orders -- only the driver differs.
    deliverFor(ctx.westDriver, 2, "2026-07-10");
    const west = driverStatementFor(getDb(), ctx.westDriver, { from: "2026-07-01", to: "2026-07-31" });
    const east = driverStatementFor(getDb(), ctx.eastDriver, { from: "2026-07-01", to: "2026-07-31" });
    expect(west.kg).toBe(20);
    expect(east.kg).toBe(0);
  });

  it("pays on what left the van, not what was ordered", () => {
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-05",
      created_by: ctx.owner,
      organization_id: 1,
      salesperson_user_id: ctx.seller,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 4 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, { driver_user_id: ctx.eastDriver, run_date: "2026-08-05", created_by: ctx.owner, organization_id: 1 });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 1 }],
      collected_toman: 0,
      by: ctx.eastDriver,
    });

    const s = driverStatementFor(db, ctx.eastDriver, { from: "2026-08-01", to: "2026-08-31" });
    expect(s.kg).toBe(10); // 1 x 20 x 0.5
  });

  it("nets payments off against the lifetime balance", () => {
    const db = getDb();
    const before = driverStatementFor(db, ctx.eastDriver, { from: "2026-01-01", to: "2026-12-29" });
    recordDriverPayment(db, {
      driver_user_id: ctx.eastDriver,
      amount_toman: 5000,
      paid_on: "2026-09-10",
      created_by: ctx.owner,
    });
    const after = driverStatementFor(db, ctx.eastDriver, { from: "2026-01-01", to: "2026-12-29" });

    expect(after.paid_toman).toBe(before.paid_toman + 5000);
    expect(after.owed_toman).toBe(after.accrued_toman - after.paid_toman);
  });

  it("is all zeroes for a driver with no deliveries, rather than throwing", () => {
    const s = driverStatementFor(getDb(), ctx.westDriver, { from: "2020-01-01", to: "2020-12-29" });
    expect(s.accrued_toman).toBe(0);
    expect(s.stops).toEqual([]);
  });
});

describe("allDriverStatements", () => {
  it("scopes to one group when a groupId is given", () => {
    const rows = allDriverStatements(getDb(), { from: "2026-01-01", to: "2026-12-29" }, { groupId: ctx.east });
    const names = rows.map((r) => r.display_name);
    expect(names).toContain("راننده شرق");
    expect(names).not.toContain("راننده غرب");
  });

  it("returns nobody for a null group, never everybody", () => {
    const rows = allDriverStatements(getDb(), { from: "2026-01-01", to: "2026-12-29" }, { groupId: null });
    expect(rows).toEqual([]);
  });

  it("agrees with the individual statement", () => {
    const db = getDb();
    const period = { from: "2026-01-01", to: "2026-12-29" };
    const row = allDriverStatements(db, period).find((r) => r.driver_user_id === ctx.eastDriver)!;
    const one = driverStatementFor(db, ctx.eastDriver, period);
    expect(row.accrued_toman).toBe(one.accrued_toman);
  });
});
