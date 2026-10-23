import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-dup-order-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { recentOpenOrders } = await import("@/lib/repo/recentOpenOrders");
const { duplicateOf } = await import("@/lib/duplicateOrder");
const { orderQuickFlow } = await import("@/lib/flows/orderQuick");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

const brief = (id: number, product_ids: number[]) => ({ id, order_no: `S-${id}`, created_at: "2026-10-23T08:00:00Z", product_ids });

describe("duplicateOf (F72)", () => {
  it("matches the same set of products, whatever the order or repeats", () => {
    expect(duplicateOf([brief(1, [3, 2])], [2, 3, 3])?.id).toBe(1);
  });
  it("a different set is a different order", () => {
    expect(duplicateOf([brief(1, [2, 3])], [2])).toBeNull();
    expect(duplicateOf([brief(1, [2])], [2, 4])).toBeNull();
    expect(duplicateOf([brief(1, [2])], [])).toBeNull();
  });
});

describe("the repeat-order flow asks before a likely double entry", () => {
  const ctx: FlowContext = {
    ...EMPTY_CONTEXT,
    entry: "order_quick",
    items: [{ id: 101, parent: 11, label: "شیر · کارتن", qty: 10, max: 999, price: 60000 }],
    vars: { today: "2026-10-23", last: "ready", last_summary: "x", debt: "0", customer_id: "5", recent_open: JSON.stringify([brief(77, [11])]) },
  };
  it("offers to open the existing order or to send this one anyway", () => {
    let st = startFlow(orderQuickFlow, ctx);
    st = answerStep(orderQuickFlow, ctx, st, "yes");
    st = answerStep(orderQuickFlow, ctx, st, "soonest");
    const v = viewStep(orderQuickFlow, ctx, st);
    expect(v.sub).toContain("S-77");
    expect(v.options.map((o) => o.id)).toEqual(["open_dup", "ok"]);
    const opened = answerStep(orderQuickFlow, ctx, st, "open_dup");
    expect(opened.values).toMatchObject({ exit: "dup", dup_id: "77" });
    expect(answerStep(orderQuickFlow, ctx, st, "ok").values.exit).toBeUndefined();
  });
  it("no recent order: the usual single confirm", () => {
    const quiet = { ...ctx, vars: { ...ctx.vars, recent_open: "" } };
    let st = startFlow(orderQuickFlow, quiet);
    st = answerStep(orderQuickFlow, quiet, st, "yes");
    st = answerStep(orderQuickFlow, quiet, st, "soonest");
    expect(viewStep(orderQuickFlow, quiet, st).options.map((o) => o.id)).toEqual(["ok"]);
  });
});

describe("recentOpenOrders", () => {
  it("lists open orders of the last 24 hours with their products; cancelled and older ones are left out", async () => {
    const db = getDb();
    await ensureWarehouse(db);
    const now = new Date().toISOString();
    const owner = Number(
      (await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('do','x','م','owner',1,?,1)").run(now)).lastInsertRowid
    );
    const cust = Number(
      (await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('DO','x','active',?,1)").run(now)).lastInsertRowid
    );
    const product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    const packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
    await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
    const order = async () =>
      await createOrder(db, {
        customer_id: cust, order_date: now.slice(0, 10), created_by: owner, organization_id: 1, salesperson_user_id: owner,
        lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
      });
    const open = await order();
    const old = await order();
    await db.prepare("UPDATE orders SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 30 * 3600_000).toISOString(), old.id);
    const gone = await order();
    await db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").run(gone.id);
    const scope = { sql: " AND o.organization_id = ?", params: [1] };
    const rows = await recentOpenOrders(scope, cust);
    expect(rows.map((r) => r.id)).toEqual([open.id]);
    expect(rows[0].product_ids).toEqual([product]);
    expect(await recentOpenOrders({ sql: " AND o.organization_id = ?", params: [2] }, cust)).toEqual([]);
  });
});
