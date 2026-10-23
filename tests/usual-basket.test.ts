import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-usual-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { customerUsualBasket } = await import("@/lib/repo/usualBasket");
const { usualBasket, usualCounts, orderQuickFlow, orderLines } = await import("@/lib/flows/orderQuick");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const line = (product_id: number, packaging_id: number, packs_ordered: number) => ({ product_id, packaging_id, packs_ordered });

describe("usualBasket (F58)", () => {
  it("keeps lines present in at least three of the last five orders, at the median packs", () => {
    const orders = [
      [line(1, 10, 4), line(2, 20, 1)],
      [line(1, 10, 6), line(3, 30, 2)],
      [line(1, 10, 5), line(2, 20, 2)],
      [line(2, 20, 3)],
      [line(1, 10, 100)],
      [line(3, 30, 9)], // a sixth order is outside the window
    ];
    expect(usualBasket(orders)).toEqual([line(1, 10, 6), line(2, 20, 2)]);
  });

  it("needs three orders before anything is «usual»", () => {
    expect(usualBasket([[line(1, 10, 4)], [line(1, 10, 4)]])).toEqual([]);
  });

  it("rounds a half-pack median up and counts a product twice in one order once", () => {
    const orders = [[line(1, 10, 1), line(1, 10, 1)], [line(1, 10, 3)], [line(1, 10, 4)], [line(1, 10, 1)]];
    expect(usualBasket(orders)).toEqual([line(1, 10, 3)]);
  });

  it("usualCounts is null when the usual basket is what last time was", () => {
    const items = [{ id: 10, label: "a", qty: 4 }, { id: 20, label: "b", qty: 0 }];
    expect(usualCounts(items, [{ id: 10, qty: 4 }])).toBeNull();
    expect(usualCounts(items, [{ id: 10, qty: 4 }, { id: 20, qty: 1 }])).toEqual({ 10: 4, 20: 1 });
    expect(usualCounts(items, [])).toBeNull();
  });

  it("the flow offers «سبد همیشگی» beside «همان سفارش قبلی» and posts the usual lines", () => {
    const ctx: FlowContext = {
      ...EMPTY_CONTEXT,
      entry: "order_quick",
      items: [
        { id: 101, parent: 11, label: "شیر · کارتن", qty: 10, max: 999, price: 60000 },
        { id: 202, parent: 12, label: "ماست · بسته", qty: 0, max: 999, price: 100000 },
      ],
      vars: { today: "2026-10-21", last: "ready", last_summary: "x", debt: "0", customer_id: "5", usual: JSON.stringify({ 101: 8, 202: 2 }), usual_summary: "شیر ۸، ماست ۲" },
    };
    let st = startFlow(orderQuickFlow, ctx);
    expect(viewStep(orderQuickFlow, ctx, st).options.map((o) => o.id)).toEqual(["yes", "usual", "change", "full"]);
    st = answerStep(orderQuickFlow, ctx, st, "usual");
    st = answerStep(orderQuickFlow, ctx, st, "soonest");
    expect(orderLines(ctx, st)).toEqual([
      { product_id: 11, packaging_id: 101, packs: 8 },
      { product_id: 12, packaging_id: 202, packs: 2 },
    ]);
    const plain = { ...ctx, vars: { ...ctx.vars, usual: "" } };
    expect(viewStep(orderQuickFlow, plain, startFlow(orderQuickFlow, plain)).options.map((o) => o.id)).not.toContain("usual");
  });
});

describe("customerUsualBasket", () => {
  it("reads the last repeatable orders in scope; drafts and other organisations are left out", async () => {
    const db = getDb();
    await ensureWarehouse(db);
    const now = new Date().toISOString();
    const owner = Number(
      (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('ub','x','م','owner',1,?,1)").run(now)).lastInsertRowid
    );
    const cust = Number(
      (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('UB','x','active',?,1)").run(now)).lastInsertRowid
    );
    const product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    const packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
    await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
    const order = async (date: string, packs: number) =>
      await createOrder(db, {
        customer_id: cust, order_date: date, created_by: owner, organization_id: 1, salesperson_user_id: owner,
        lines: [{ product_id: product, packaging_id: packaging, packs }],
      });
    await confirmOrder(db, (await order("2026-02-01", 2)).id);
    await confirmOrder(db, (await order("2026-02-08", 3)).id);
    await order("2026-02-10", 50); // draft
    const scope = { sql: " AND o.organization_id = ?", params: [1] };
    expect(await customerUsualBasket(scope, cust)).toEqual([]);
    await confirmOrder(db, (await order("2026-02-15", 4)).id);
    expect(await customerUsualBasket(scope, cust)).toEqual([{ product_id: product, packaging_id: packaging, packs_ordered: 3 }]);
    expect(await customerUsualBasket({ sql: " AND o.organization_id = ?", params: [2] }, cust)).toEqual([]);
  });
});
