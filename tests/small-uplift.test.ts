import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-uplift-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { setUpliftRule, listUpliftRules } = await import("@/lib/repo/smallUplift");
const { upliftPercentFor, upliftedPrice, upliftRuleProblem } = await import("@/lib/smallUplift");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("uplift rule maths", () => {
  const rule = { smallPacks: 5, percent: 10 };
  it("applies only below the pack count", () => {
    expect(upliftPercentFor(3, rule)).toBe(10);
    expect(upliftPercentFor(5, rule)).toBe(0);
    expect(upliftPercentFor(3, null)).toBe(0);
    expect(upliftPercentFor(3, rule, true)).toBe(0);
  });
  it("raises the unit price by the percent", () => {
    expect(upliftedPrice(100000, 10)).toBe(110000);
    expect(upliftedPrice(100000, 0)).toBe(100000);
  });
  it("wants both numbers or neither", () => {
    expect(upliftRuleProblem(null, null)).toBeNull();
    expect(upliftRuleProblem(5, null)).toMatch(/هر دو/);
    expect(upliftRuleProblem(1, 10)).toMatch(/۲/);
    expect(upliftRuleProblem(5, 101)).toMatch(/۱۰۰/);
  });
});

let rep = 0, cust = 0, product = 0, packaging = 0;
const place = async (packs: number, extra: Record<string, unknown> = {}) => {
  const id = Number(((await createOrder(getDb(), { customer_id: cust, order_date: "2026-11-13", created_by: rep, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs }], ...extra } as never)) as unknown as { id: number }).id);
  return (await getDb().prepare("SELECT unit_price_toman AS p, uplift_percent AS u FROM order_lines WHERE order_id = ?").get(id)) as { p: number; u: number };
};

beforeAll(async () => {
  const db = getDb();
  rep = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('u-rep','x:y','م','phone_sales',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('U1','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
  await ensureWarehouse(db);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: product, packaging_id: packaging, price_toman: 1000, valid_from: "2026-01-01", organization_id: 1 } as never);
});

describe("small-quantity uplift on an order", () => {
  it("changes nothing until a rule is set", async () => {
    expect(await place(2)).toEqual({ p: 1000, u: 0 });
  });
  it("freezes the higher price and its percent on a small order", async () => {
    expect(await setUpliftRule(1, packaging, 5, 10)).toBeNull();
    expect((await listUpliftRules(1))[0]).toMatchObject({ small_packs: 5, percent: 10 });
    expect(await place(2)).toEqual({ p: 1100, u: 10 });
  });
  it("leaves a big order and a waived order at the normal price", async () => {
    expect(await place(5)).toEqual({ p: 1000, u: 0 });
    expect(await place(2, { waive_uplift: { reason: "قیمت توافقی", by: rep } })).toEqual({ p: 1000, u: 0 });
  });
  it("refuses a pack of another company and a half rule", async () => {
    expect(await setUpliftRule(2, packaging, 5, 10)).toMatch(/پیدا/);
    expect(await setUpliftRule(1, packaging, 5, null)).toMatch(/هر دو/);
  });
  it("clears the rule", async () => {
    expect(await setUpliftRule(1, packaging, null, null)).toBeNull();
    expect(await place(2)).toEqual({ p: 1000, u: 0 });
  });
});
