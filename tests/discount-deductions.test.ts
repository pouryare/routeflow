import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `discount-deductions-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { requestDiscount } = await import("@/lib/repo/discounts");
const { statementFor } = await import("@/lib/commissionLedger");
const { driverStatementFor } = await import("@/lib/driverCommissionLedger");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { group: 0, otherGroup: 0, owner: 0, gm: 0, gmOther: 0, seller: 0, driver: 0, customer: 0, product: 0, packaging: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const group = async (slug: string) =>
    Number((await db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, '#0ff', 1, ?)").run(slug, slug, now)).lastInsertRowid);
  const user = async (name: string, role: string, groupId: number | null) =>
    Number(
      (await db
        .prepare("INSERT INTO users (username, password_hash, display_name, role, group_id, organization_id, active, created_at) VALUES (?, 'x', ?, ?, ?, 1, 1, ?)")
        .run(name, name, role, groupId, now)).lastInsertRowid
    );
  ctx.group = await group("east");
  ctx.otherGroup = await group("west");
  ctx.owner = await user("owner", "owner", null);
  ctx.gm = await user("gm", "group_manager", ctx.group);
  ctx.gmOther = await user("gm2", "group_manager", ctx.otherGroup);
  ctx.seller = await user("seller", "phone_sales", ctx.group);
  ctx.driver = await user("driver", "delivery_driver", ctx.group);
  ctx.customer = Number(
    (await db.prepare("INSERT INTO customers (customer_code, business_name, group_id, synced_at, organization_id) VALUES ('C1', 'رستوران', ?, ?, 1)").run(ctx.group, now)).lastInsertRowid
  );
  ctx.product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  ctx.packaging = await createPackaging(db, { product_id: ctx.product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: ctx.product, price_toman: 10_000, valid_from: "2026-01-01" });
});

const period = { from: "2026-08-01", to: "2026-08-31" };
const newOrder = async () =>
  (await createOrder(getDb(), {
    customer_id: ctx.customer,
    order_date: "2026-08-26",
    created_by: ctx.seller,
    organization_id: 1,
    salesperson_user_id: ctx.seller,
    lines: [{ product_id: ctx.product, packaging_id: ctx.packaging, packs: 2 }],
  })).id;
const shares = () => [
  { user_id: ctx.seller, ledger: "sales" as const, share_pct: 50 },
  { user_id: ctx.driver, ledger: "driver" as const, share_pct: 50 },
];

describe("discount deductions on commission statements", () => {
  it("charges each person their share once the order is delivered, and carries what earnings cannot cover", async () => {
    const id = await newOrder();
    const d = await requestDiscount(1, id, { id: ctx.owner, role: "owner" }, { kind: "percent", value: 10, reason: "loyal", shares: shares() });
    await getDb().prepare("UPDATE orders SET status = 'DELIVERED' WHERE id = ?").run(id);
    const s = await statementFor(getDb(), ctx.seller, period);
    expect(s.deduction_toman).toBe(d.amount_toman / 2);
    expect(s.deductions.map((x) => x.order_id)).toEqual([id]);
    // No rate is set, so nothing was earned: the whole deduction carries forward.
    expect(s.carried_toman).toBe(s.deduction_toman - (s.accrued_toman - s.net_toman));
    expect(s.net_toman).toBe(s.accrued_toman - (s.deduction_toman - s.carried_toman));
    expect(s.owed_toman).toBe(s.accrued_toman - s.deduction_toman - s.paid_toman);
    const dr = await driverStatementFor(getDb(), ctx.driver, period);
    expect(dr.deduction_toman).toBe(d.amount_toman / 2);
  });

  it("a returned order voids its shares, and a rejected or undelivered one never counts", async () => {
    const id = await newOrder();
    await requestDiscount(1, id, { id: ctx.owner, role: "owner" }, { kind: "amount", value: 1000, reason: "loyal", shares: shares() });
    const before = (await statementFor(getDb(), ctx.seller, period)).deduction_toman;
    await getDb().prepare("UPDATE orders SET status = 'DELIVERED' WHERE id = ?").run(id);
    expect((await statementFor(getDb(), ctx.seller, period)).deduction_toman).toBe(before + 500);
    await getDb().prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").run(id);
    expect((await statementFor(getDb(), ctx.seller, period)).deduction_toman).toBe(before);
  });
});
