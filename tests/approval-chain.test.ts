import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-approval-chain-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

const { needsOwnerStep } = await import("@/lib/approvalChain");

describe("F129 two-step approval", () => {
  it("needs the owner only above the limit, never when the limit is 0", () => {
    const a = { kind: "value", customer_balance_toman: 40_000, overage_toman: 10_000 };
    expect(needsOwnerStep(a, 0)).toBe(false);
    expect(needsOwnerStep(a, 30_000)).toBe(true);
    expect(needsOwnerStep({ kind: "credit", customer_balance_toman: 90_000, overage_toman: 10_000 }, 30_000)).toBe(false);
  });

  it("a manager's approval passes a big one to the owner, and the owner's finishes it", async () => {
    const db = getDb();
    await db.prepare("UPDATE organizations SET order_approval_limit_toman = 30000, approval_owner_limit_toman = 35000 WHERE id = 1").run();
    const big = await draft(2); // 40,000: over both
    expect(await submitOrder(1, big, { id: null, role: "system" })).toBe("PENDING_CREDIT");
    const card = (await pendingForDeck(1)).find((c) => c.two_step)!;
    expect(card.manager_ok).toBe(false);
    expect(await decide(1, card.id, "approved", owner, undefined, undefined, false)).toBe("forwarded");
    expect(((await db.prepare("SELECT status FROM orders WHERE id = ?").get(big)) as { status: string }).status).toBe("PENDING_CREDIT");
    expect((await pendingForDeck(1, null)).some((c) => c.id === card.id)).toBe(false); // gone from the manager's deck
    expect((await pendingForDeck(1)).find((c) => c.id === card.id)?.manager_ok).toBe(true);
    await expect(decide(1, card.id, "approved", owner, undefined, undefined, false)).rejects.toThrow();
    expect(await decide(1, card.id, "approved", owner)).toBe("decided");
    expect(((await db.prepare("SELECT status FROM orders WHERE id = ?").get(big)) as { status: string }).status).toBe("CONFIRMED");
  });

  it("a manager decides a small one alone", async () => {
    const small = await draft(2);
    await getDb().prepare("UPDATE organizations SET approval_owner_limit_toman = 100000 WHERE id = 1").run();
    expect(await submitOrder(1, small, { id: null, role: "system" })).toBe("PENDING_CREDIT");
    const card = (await pendingForDeck(1)).find((c) => !c.two_step)!;
    expect(await decide(1, card.id, "approved", owner, undefined, undefined, false)).toBe("decided");
  });
});
