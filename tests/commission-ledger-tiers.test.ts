import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `ledger-tiers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { createRun, addStop, readRun, recordDelivery } = await import("@/lib/delivery");
const { setRate, recordPayment, statementFor } = await import("@/lib/commissionLedger");
const { savePlan, planFor } = await import("@/lib/repo/commissionTiers");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { owner: 0, nazanin: 0, yasamin: 0, driver: 0, customer: 0, product: 0, packaging: 0 };

/** 2 packs x 100 per pack x 0.25kg = 50 kg, delivered in full. */
async function sellAndDeliver(packs: number, orderDate: string, seller: number): Promise<number> {
  const db = getDb();
  const order = await createOrder(db, {
    customer_id: ctx.customer,
    order_date: orderDate,
    created_by: ctx.owner,
    organization_id: 1,
    salesperson_user_id: seller,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs }],
  });
  await confirmOrder(db, order.id);
  const run = await createRun(db, {
    driver_user_id: ctx.driver,
    run_date: orderDate,
    created_by: ctx.owner,
    organization_id: 1,
  });
  const stopId = await addStop(db, run, order.id);
  const stop = (await readRun(db, run))!.stops.find((s) => s.id === stopId)!;
  await recordDelivery(db, stopId, {
    lines: stop.lines.map((l) => ({ line_id: l.id, packs_delivered: packs })),
    collected_toman: 0,
    by: ctx.driver,
  });
  return order.id;
}

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const group = Number(
    (await db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("شرق", "east", "#0ff", now)).lastInsertRowid,
  );
  const user = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, ?)",
  );
  ctx.owner = Number((await user.run("o", "مالک", "owner", null, now)).lastInsertRowid);
  ctx.nazanin = Number((await user.run("nazanin", "نازنین", "phone_sales", group, now)).lastInsertRowid);
  ctx.yasamin = Number((await user.run("yasamin", "یاسمین", "phone_sales", group, now)).lastInsertRowid);
  ctx.driver = Number((await user.run("d", "راننده", "delivery_driver", group, now)).lastInsertRowid);
  ctx.customer = Number(
    (await db.prepare("INSERT INTO customers (customer_code, business_name, group_id, synced_at) VALUES (?, ?, ?, ?)")
      .run("C1", "رستوران نمونه", group, now)).lastInsertRowid,
  );
  ctx.product = await createProduct(db, { name: "کره گیاهی", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = await createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: ctx.product, price_toman: 440000, valid_from: "2026-01-01" });
  await setRate(db, { rate_per_kg_toman: 2000, valid_from: "2026-01-01", created_by: ctx.owner });
});

describe("a tiered plan in the ledger", () => {
  it("a salesperson with NO plan gets exactly today's flat statement", async () => {
    // THE compatibility guarantee, asserted rather than assumed. These people are on real
    // payroll today; if the flat path moved at all, this is where it shows.
    const db = getDb();
    await sellAndDeliver(2, "2026-05-10", ctx.nazanin);
    const s = await statementFor(db, ctx.nazanin, { from: "2026-05-01", to: "2026-05-31" });
    expect(s.accrued_toman).toBe(100_000); // 50kg x 2000
    for (const o of s.orders) expect(o.rate_per_kg_toman).toBe(2000);
    // And it declares it is NOT on a plan, so the UI cannot imply a tier is in force.
    expect(s.plan_mode).toBeNull();
  });

  it("a plan REPLACES the flat rate for the same person", async () => {
    const db = getDb();
    const before = (await statementFor(db, ctx.nazanin, { from: "2026-05-01", to: "2026-05-31" })).accrued_toman;
    await savePlan({
      salesperson_user_id: ctx.nazanin,
      organization_id: 1,
      // 50kg x 100 (first tier, whole period) = 5,000, against 100,000 flat.
      plan: {
        mode: "marginal",
        metric: "kg",
        tiers: [
          { from_value: 0, to_value: 50, rate_type: "flat", rate_value: 100 },
          { from_value: 50, to_value: null, rate_type: "flat", rate_value: 300 },
        ],
      },
      valid_from: "2026-01-01",
      created_by: ctx.owner,
    });
    const s = await statementFor(db, ctx.nazanin, { from: "2026-05-01", to: "2026-05-31" });
    expect(s.accrued_toman).toBe(5_000);
    expect(s.accrued_toman).not.toBe(before);
    expect(s.plan_mode).toBe("marginal");
  });

  it("the plan is measured over the WHOLE PERIOD, not per order", async () => {
    // Two 30kg orders in one month. Per-order, each would pay 30 x 100. Period-level, both
    // together are 60kg: the first 50 at 100 and the next 10 at 300 = 5,000 + 3,000.
    // Splitting per order would mean the same 60kg paid differently depending on how it was
    // invoiced, which is not a plan anyone would agree to.
    const db = getDb();
    await sellAndDeliver(1.2, "2026-07-05", ctx.yasamin); // 1.2 packs x 100 x 0.25 = 30kg
    await sellAndDeliver(1.2, "2026-07-12", ctx.yasamin);
    await savePlan({
      salesperson_user_id: ctx.yasamin,
      organization_id: 1,
      plan: {
        mode: "marginal",
        metric: "kg",
        tiers: [
          { from_value: 0, to_value: 50, rate_type: "flat", rate_value: 100 },
          { from_value: 50, to_value: null, rate_type: "flat", rate_value: 300 },
        ],
      },
      valid_from: "2026-01-01",
      created_by: ctx.owner,
    });
    const s = await statementFor(db, ctx.yasamin, { from: "2026-07-01", to: "2026-07-31" });
    expect(s.kg).toBeCloseTo(60, 6);
    expect(s.accrued_toman).toBe(50 * 100 + 10 * 300);
  });

  it("a backdated plan restates UNPAID accruals and never a recorded payment", async () => {
    // The asymmetry lib/commission.ts already documents, preserved for tiers. A payment is a
    // fact about money that moved; a rate is a calculation and may be restated.
    const db = getDb();
    await recordPayment(db, { salesperson_user_id: ctx.nazanin, amount_toman: 1000, paid_on: "2026-03-01" });
    const before = await statementFor(db, ctx.nazanin, { from: "2026-03-01", to: "2026-03-31" });
    // Backdate the plan to cover March, where nothing was sold but the payment sits.
    await savePlan({
      salesperson_user_id: ctx.nazanin,
      organization_id: 1,
      plan: { mode: "marginal", metric: "kg", tiers: [{ from_value: 0, to_value: null, rate_type: "flat", rate_value: 7 }] },
      valid_from: "2026-03-01",
      created_by: ctx.owner,
    });
    const after = await statementFor(db, ctx.nazanin, { from: "2026-03-01", to: "2026-03-31" });
    expect(after.paid_toman).toBe(before.paid_toman);
    expect(after.paid_toman).toBe(1000);
    expect(after.owed_toman).not.toBe(before.owed_toman);
  });

  it("rate_per_kg_toman reports the tier's effective rate, not a per-kilogram lie", async () => {
    // 60kg in July for yasamin: she is past the first tier, so her effective rate is 300.
    const db = getDb();
    const s = await statementFor(db, ctx.yasamin, { from: "2026-07-01", to: "2026-07-31" });
    for (const o of s.orders) expect(o.rate_per_kg_toman).toBe(300);
  });

  it("someone else's plan never touches this person's statement", async () => {
    const db = getDb();
    // The OWNER, not Yasamin: an earlier test in this file gives Yasamin her own plan from
    // 2026-01-01, so she is legitimately on one. The owner has never been given one, which
    // makes him the only person here who can demonstrate the default.
    await sellAndDeliver(2, "2026-05-12", ctx.owner);
    await savePlan({
      salesperson_user_id: ctx.nazanin,
      organization_id: 1,
      plan: { mode: "marginal", metric: "kg", tiers: [{ from_value: 0, to_value: null, rate_type: "flat", rate_value: 999_999 }] },
      valid_from: "2026-01-01",
      created_by: ctx.owner,
    });
    const s = await statementFor(db, ctx.owner, { from: "2026-05-01", to: "2026-05-31" });
    // Flat, unchanged, and explicitly not on a plan.
    expect(s.accrued_toman).toBe(100_000);
    expect(s.plan_mode).toBeNull();
    // And planFor agrees: nobody else's plan is in force for him.
    expect(await planFor(1, ctx.owner, "2026-05-31", db)).toBeNull();
  });
});
