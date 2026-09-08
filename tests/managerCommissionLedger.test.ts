import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-mgrledger-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { setRate } = await import("@/lib/commissionLedger");
const { setManagerOverride, recordManagerPayment, managerStatementFor, allManagerStatements } = await import(
  "@/lib/managerCommissionLedger"
);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = {
  east: 0,
  west: 0,
  owner: 0,
  eastManager: 0,
  westManager: 0,
  seller: 0,
  driver: 0,
  customer: 0,
  product: 0,
  packaging: 0,
};

/** Sells 2000 تومان × kg to the shared فروشنده and delivers it same-day, so every call
 *  produces a known, round accrual to check the override percentage against. */
function sellAndDeliver(packs: number, orderDate: string): number {
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
  const run = createRun(db, { driver_user_id: ctx.driver, run_date: orderDate, created_by: ctx.owner, organization_id: 1 });
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

  const group = db.prepare(
    "INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)"
  );
  ctx.east = Number(group.run("شرق", "east", "#0ff", now).lastInsertRowid);
  ctx.west = Number(group.run("غرب", "west", "#f0f", now).lastInsertRowid);

  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)"
  );
  ctx.owner = Number(user.run("o", "مالک", "owner", null, now).lastInsertRowid);
  ctx.eastManager = Number(user.run("me", "مدیر شرق", "group_manager", ctx.east, now).lastInsertRowid);
  ctx.westManager = Number(user.run("mw", "مدیر غرب", "group_manager", ctx.west, now).lastInsertRowid);
  ctx.seller = Number(user.run("s", "فروشنده", "salesperson", ctx.east, now).lastInsertRowid);
  ctx.driver = Number(user.run("d", "راننده", "driver", ctx.east, now).lastInsertRowid);

  ctx.customer = Number(
    db
      .prepare("INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)")
      .run("C1", "رستوران نمونه", ctx.east, now).lastInsertRowid
  );

  ctx.product = createProduct(db, { name: "دوغ", kg_per_base_unit: 1, organization_id: 1 });
  ctx.packaging = createPackaging(db, { product_id: ctx.product, name: "کارتن", qty_per_pack: 10 });
  setPrice(db, { product_id: ctx.product, price_toman: 50000, valid_from: "2026-01-01" });

  // 2000 تومان/kg for the فروشنده -- 10 packs x 10 x 1kg = 100kg = 200,000 تومان accrued.
  setRate(db, { rate_per_kg_toman: 2000, valid_from: "2026-01-01", created_by: ctx.owner });
});

describe("managerStatementFor", () => {
  it("is a percentage of the whole group's فروشنده accrual, not a weight of their own", () => {
    setManagerOverride(getDb(), {
      manager_user_id: ctx.eastManager,
      override_pct: 10,
      valid_from: "2026-01-01",
      created_by: ctx.owner,
    });
    sellAndDeliver(10, "2026-05-10");

    const s = managerStatementFor(getDb(), ctx.eastManager, { from: "2026-05-01", to: "2026-05-31" });
    expect(s.group_accrued_toman).toBe(200000);
    expect(s.accrued_toman).toBe(20000); // 10% of 200,000
  });

  it("uses the override in force on each order's OWN date, not today's", () => {
    const db = getDb();
    // Raise the override mid-year -- June's orders earn the new rate, May's do not.
    setManagerOverride(db, {
      manager_user_id: ctx.eastManager,
      override_pct: 25,
      valid_from: "2026-06-01",
      created_by: ctx.owner,
    });
    sellAndDeliver(10, "2026-06-10"); // another 200,000 group accrual, at 25%

    const june = managerStatementFor(db, ctx.eastManager, { from: "2026-06-01", to: "2026-06-30" });
    expect(june.accrued_toman).toBe(50000); // 25% of 200,000

    const lifetime = managerStatementFor(db, ctx.eastManager, { from: "2026-01-01", to: "2026-12-29" });
    // May's 200,000 at 10% (20,000) plus June's 200,000 at 25% (50,000) -- never the
    // later rate applied to both, which a naive "today's rate x lifetime total" would do.
    expect(lifetime.accrued_toman).toBe(70000);
  });

  it("is zero for a manager with no group", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const orphan = Number(
      db
        .prepare(
          "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, 'group_manager', NULL, 1, ?)"
        )
        .run("orphan", "مدیر بی‌گروه", now).lastInsertRowid
    );
    setManagerOverride(db, { manager_user_id: orphan, override_pct: 50, valid_from: "2026-01-01", created_by: ctx.owner });
    const s = managerStatementFor(db, orphan, { from: "2026-01-01", to: "2026-12-29" });
    expect(s.group_accrued_toman).toBe(0);
    expect(s.accrued_toman).toBe(0);
  });

  it("nets payments off against the lifetime balance", () => {
    const db = getDb();
    const before = managerStatementFor(db, ctx.eastManager, { from: "2026-01-01", to: "2026-12-29" });
    recordManagerPayment(db, {
      manager_user_id: ctx.eastManager,
      amount_toman: 10000,
      paid_on: "2026-09-10",
      created_by: ctx.owner,
    });
    const after = managerStatementFor(db, ctx.eastManager, { from: "2026-01-01", to: "2026-12-29" });
    expect(after.paid_toman).toBe(before.paid_toman + 10000);
    expect(after.owed_toman).toBe(after.accrued_toman - after.paid_toman);
  });

  it("is all zeroes for a manager with no override set, rather than throwing", () => {
    const s = managerStatementFor(getDb(), ctx.westManager, { from: "2026-01-01", to: "2026-12-29" });
    expect(s.override_pct).toBe(0);
    expect(s.accrued_toman).toBe(0);
  });
});

describe("allManagerStatements", () => {
  it("returns a row per مدیر گروه", () => {
    const rows = allManagerStatements(getDb(), { from: "2026-01-01", to: "2026-12-29" });
    const names = rows.map((r) => r.display_name);
    expect(names).toContain("مدیر شرق");
    expect(names).toContain("مدیر غرب");
  });
});
