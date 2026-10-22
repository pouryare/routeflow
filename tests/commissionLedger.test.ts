import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-comledger-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { setRate, recordPayment, statementFor, allStatements } = await import(
  "@/lib/commissionLedger"
);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  group: 0,
  owner: 0,
  nazanin: 0,
  yasamin: 0,
  driver: 0,
  customer: 0,
  product: 0,
  packaging: 0,
};

/** Confirms an order and delivers every line in full. */
function sellAndDeliver(packs: number, orderDate: string, seller: number | null): number {
  const db = getDb();
  const order = createOrder(db, {
    customer_id: ctx.customer,
    order_date: orderDate,
    created_by: ctx.owner,
    organization_id: 1,
    salesperson_user_id: seller,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs }],
  });
  confirmOrder(db, order.id);

  const run = createRun(db, {
    driver_user_id: ctx.driver,
    run_date: orderDate,
    created_by: ctx.owner,
    organization_id: 1,
  });
  const stopId = addStop(db, run, order.id);
  const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
  recordDelivery(db, stopId, {
    lines: stop.lines.map((l) => ({ line_id: l.id, packs_delivered: packs })),
    collected_toman: 0,
    by: ctx.driver,
  });
  return order.id;
}

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();

  ctx.group = Number(
    db
      .prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("شرق", "east", "#0ff", now).lastInsertRowid
  );
  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x', ?, ?, ?, 1, ?, 1)"
  );
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.nazanin = Number(user.run("nazanin", "نازنین", "phone_sales", ctx.group, now).lastInsertRowid);
  ctx.yasamin = Number(user.run("yasamin", "یاسمین", "phone_sales", ctx.group, now).lastInsertRowid);
  ctx.driver = Number(user.run("d", "راننده", "delivery_driver", ctx.group, now).lastInsertRowid);

  ctx.customer = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)"
      )
      .run("C1", "رستوران نمونه", ctx.group, now).lastInsertRowid
  );

  ctx.product = createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });

  // 2000 تومان per kilogram for everyone, from the start of the year.
  setRate(db, { rate_per_kg_toman: 2000, valid_from: "2026-01-01", created_by: ctx.owner });
});

describe("statementFor", () => {
  it("accrues on delivered weight at the company rate", () => {
    // 2 packs x 100 عدد x 0.25kg = 50kg, at 2000 = 100,000 تومان
    sellAndDeliver(2, "2026-05-10", ctx.nazanin);
    const s = statementFor(getDb(), ctx.nazanin, { from: "2026-05-01", to: "2026-05-31" });
    expect(s.accrued_toman).toBe(100000);
    expect(s.kg).toBe(50);
  });

  it("uses a personal rate once it starts, and the default before", () => {
    const db = getDb();
    setRate(db, {
      salesperson_user_id: ctx.nazanin,
      rate_per_kg_toman: 3000,
      valid_from: "2026-06-01",
      created_by: ctx.owner,
    });

    sellAndDeliver(2, "2026-06-10", ctx.nazanin);
    const june = statementFor(db, ctx.nazanin, { from: "2026-06-01", to: "2026-06-30" });
    expect(june.accrued_toman).toBe(150000); // 50kg x 3000

    const may = statementFor(db, ctx.nazanin, { from: "2026-05-01", to: "2026-05-31" });
    expect(may.accrued_toman).toBe(100000); // still the old default
  });

  it("counts only that person's orders", () => {
    sellAndDeliver(2, "2026-07-10", ctx.yasamin);
    const nazanin = statementFor(getDb(), ctx.nazanin, { from: "2026-07-01", to: "2026-07-31" });
    expect(nazanin.accrued_toman).toBe(0);

    const yasamin = statementFor(getDb(), ctx.yasamin, { from: "2026-07-01", to: "2026-07-31" });
    expect(yasamin.accrued_toman).toBe(100000);
  });

  it("ignores an order that was never delivered", () => {
    // Confirmed is a promise; commission is earned when the goods leave the van.
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-08-05",
      created_by: ctx.owner,
      organization_id: 1,
      salesperson_user_id: ctx.nazanin,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 10 }],
    });
    confirmOrder(db, order.id);

    const s = statementFor(db, ctx.nazanin, { from: "2026-08-01", to: "2026-08-31" });
    expect(s.accrued_toman).toBe(0);
  });

  it("pays on what was delivered, not what was ordered", () => {
    const db = getDb();
    const order = createOrder(db, {
      customer_id: ctx.customer,
      order_date: "2026-09-05",
      created_by: ctx.owner,
      organization_id: 1,
      salesperson_user_id: ctx.nazanin,
      lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 3 }],
    });
    confirmOrder(db, order.id);
    const run = createRun(db, {
      driver_user_id: ctx.driver,
      run_date: "2026-09-05",
      created_by: ctx.owner,
      organization_id: 1,
    });
    const stopId = addStop(db, run, order.id);
    const stop = readRun(db, run)!.stops.find((s) => s.id === stopId)!;
    // Customer took one of the three boxes.
    recordDelivery(db, stopId, {
      lines: [{ line_id: stop.lines[0].id, packs_delivered: 1 }],
      collected_toman: 0,
      by: ctx.driver,
    });

    const s = statementFor(db, ctx.nazanin, { from: "2026-09-01", to: "2026-09-30" });
    expect(s.kg).toBe(25); // 1 x 100 x 0.25
    expect(s.accrued_toman).toBe(75000); // at her 3000 rate
  });

  it("nets payments off against the lifetime balance", () => {
    const db = getDb();
    const before = statementFor(db, ctx.nazanin, { from: "2026-01-01", to: "2026-12-29" });
    recordPayment(db, {
      salesperson_user_id: ctx.nazanin,
      amount_toman: 50000,
      paid_on: "2026-09-10",
      created_by: ctx.owner,
    });
    const after = statementFor(db, ctx.nazanin, { from: "2026-01-01", to: "2026-12-29" });

    expect(after.paid_toman).toBe(before.paid_toman + 50000);
    expect(after.owed_toman).toBe(after.accrued_toman - after.paid_toman);
  });

  it("lists the orders behind the figure", () => {
    const s = statementFor(getDb(), ctx.nazanin, { from: "2026-05-01", to: "2026-05-31" });
    expect(s.orders).toHaveLength(1);
    expect(s.orders[0].customer_name).toBe("رستوران نمونه");
    expect(s.orders[0].accrual_toman).toBe(100000);
  });

  it("is all zeroes for someone with no orders, rather than throwing", () => {
    const s = statementFor(getDb(), ctx.yasamin, { from: "2020-01-01", to: "2020-12-29" });
    expect(s.accrued_toman).toBe(0);
    expect(s.orders).toEqual([]);
  });
});

describe("allStatements", () => {
  it("returns a row per salesperson", () => {
    const rows = allStatements(getDb(), { from: "2026-01-01", to: "2026-12-29" }, { organizationId: 1 });
    const names = rows.map((r) => r.display_name);
    expect(names).toContain("نازنین");
    expect(names).toContain("یاسمین");
  });

  it("does not include drivers or managers", () => {
    const rows = allStatements(getDb(), { from: "2026-01-01", to: "2026-12-29" }, { organizationId: 1 });
    expect(rows.map((r) => r.display_name)).not.toContain("راننده");
    expect(rows.map((r) => r.display_name)).not.toContain("مالک");
  });

  it("agrees with the individual statement", () => {
    const db = getDb();
    const period = { from: "2026-01-01", to: "2026-12-29" };
    const row = allStatements(db, period, { organizationId: 1 }).find((r) => r.salesperson_user_id === ctx.nazanin)!;
    const one = statementFor(db, ctx.nazanin, period);
    expect(row.accrued_toman).toBe(one.accrued_toman);
    expect(row.owed_toman).toBe(one.owed_toman);
  });
});
