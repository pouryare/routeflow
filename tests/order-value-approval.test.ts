import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-value-approval-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, submitOrder } = await import("@/lib/orders");
const { decide, pendingForDeck } = await import("@/lib/repo/creditApprovals");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let owner = 0, cust = 0, product = 0, packaging = 0;
const line = (packs: number) => ({ product_id: product, packaging_id: packaging, packs });
const draft = async (packs: number) =>
  ((await createOrder(getDb(), { customer_id: cust, order_date: "2026-11-13", created_by: owner, organization_id: 1, lines: [line(packs)] } as never)) as unknown as { id: number }).id;

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('va-o','x:y','م','owner',1,?,1)").run(now)).lastInsertRowid);
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('VA1','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
  await ensureWarehouse(db);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: product, price_toman: 20_000, valid_from: "2026-01-01" }); // one pack = 20,000
});

describe("F76 order approval by value", () => {
  it("does nothing while the limit is 0", async () => {
    expect(await submitOrder(1, await draft(3), { id: null, role: "system" })).toBe("PENDING_REVIEW");
  });

  it("holds an order above the limit, shows it as a value request, and approving confirms it", async () => {
    await getDb().prepare("UPDATE organizations SET order_approval_limit_toman = 30000 WHERE id = 1").run();
    const small = await draft(1); // 20,000: under
    expect(await submitOrder(1, small, { id: null, role: "system" })).toBe("PENDING_REVIEW");
    const big = await draft(2); // 40,000: over
    expect(await submitOrder(1, big, { id: null, role: "system" })).toBe("PENDING_CREDIT");
    const card = (await pendingForDeck(1)).find((c) => c.kind === "value");
    expect(card).toMatchObject({ customer_balance_toman: 40_000, credit_limit_toman: 30_000, overage_toman: 10_000 });
    await decide(1, card!.id, "approved", owner);
    const after = (await getDb().prepare("SELECT status FROM orders WHERE id = ?").get(big)) as { status: string };
    expect(after.status).toBe("CONFIRMED");
  });

  it("lets a signed-in owner's own big order through", async () => {
    expect(await submitOrder(1, await draft(2), { id: owner, role: "owner" })).toBe("PENDING_REVIEW");
  });
});
