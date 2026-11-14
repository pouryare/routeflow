import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-minorder-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { belowMin, cleanReason } = await import("@/lib/minOrder");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("minimum order rule", () => {
  it("is off at 0 and only flags a real basket below the minimum", () => {
    expect(belowMin(100, 0)).toBe(false);
    expect(belowMin(0, 500)).toBe(false);
    expect(belowMin(320, 500)).toBe(true);
    expect(belowMin(500, 500)).toBe(false);
  });
  it("keeps a trimmed reason of at most 100 characters", () => {
    expect(cleanReason("  ")).toBeNull();
    expect(cleanReason(" الف ")).toBe("الف");
    expect(cleanReason("ب".repeat(300))).toHaveLength(100);
  });
});

let rep = 0, cust = 0, product = 0, packaging = 0;
const place = async (extra: Record<string, unknown>) =>
  createOrder(getDb(), { customer_id: cust, order_date: "2026-11-13", created_by: rep, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }], ...extra } as never);

beforeAll(async () => {
  const db = getDb();
  rep = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('m-rep','x:y','م','phone_sales',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('M1','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
  await ensureWarehouse(db);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: product, packaging_id: packaging, price_toman: 1000, valid_from: "2026-01-01", organization_id: 1 } as never);
});

describe("createOrder with a minimum", () => {
  it("refuses a small order with no reason", async () => {
    await expect(place({ min_order_toman: 5000 })).rejects.toThrow(/حداقل/);
  });
  it("saves it with a reason and keeps the reason", async () => {
    const id = Number(((await place({ min_order_toman: 5000, below_min_reason: "مشتری تازه است" })) as unknown as { id: number }).id);
    const row = (await getDb().prepare("SELECT below_min_reason AS r FROM orders WHERE id = ?").get(id)) as { r: string };
    expect(row.r).toBe("مشتری تازه است");
  });
  it("does not check when no minimum is passed", async () => {
    await expect(place({})).resolves.toBeTruthy();
  });
});
