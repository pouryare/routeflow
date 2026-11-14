import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-pre-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder } = await import("@/lib/orders");
const { createPurchaseOrder, incomingByProduct } = await import("@/lib/repo/purchaseOrders");
const { unpromisedIncoming, fillPreorders } = await import("@/lib/repo/preorders");
const { reserveForOrder } = await import("@/lib/repo/stock");
const { recordPurchase } = await import("@/lib/purchases");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let user = 0, cust = 0, product = 0, packaging = 0, po = 0;
const order = async (packs: number, preorder: boolean) =>
  ((await createOrder(getDb(), { customer_id: cust, order_date: "2026-11-13", created_by: user, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs, preorder }] } as never)) as unknown as { id: number }).id;

beforeAll(async () => {
  const db = getDb();
  user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('pre-u','x:y','م','owner',1,?,1)").run(new Date().toISOString())).lastInsertRowid);
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('P1','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
  await ensureWarehouse(db);
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
  await setPrice(db, { product_id: product, packaging_id: packaging, price_toman: 1000, valid_from: "2026-01-01", organization_id: 1 } as never);
  const sup = Number((await db.prepare("INSERT INTO suppliers (organization_id, name, created_at) VALUES (1,'تأمین',?)").run(new Date().toISOString())).lastInsertRowid);
  po = await createPurchaseOrder(1, { supplier_id: sup, expected_date: "2026-11-20", created_by: user, send: true, lines: [{ product_id: product, base_qty: 100, unit_cost_toman: 500 }] });
});

describe("pre-orders against incoming stock", () => {
  it("promises only what is left of the incoming goods, first come first served", async () => {
    expect(await unpromisedIncoming(getDb(), 1, product)).toBe(100);
    await order(6, true); // 60
    expect(await unpromisedIncoming(getDb(), 1, product)).toBe(40);
    expect((await incomingByProduct(1)).get(product)?.qty).toBe(40);
    await expect(order(5, true)).rejects.toThrow(/باقی نیست/); // 50 > 40
    await order(4, true); // 40
    expect(await unpromisedIncoming(getDb(), 1, product)).toBe(0);
    await order(1, false); // an ordinary line is not limited by the incoming goods
  });
  it("turns into a normal reservation when the goods arrive", async () => {
    const db = getDb();
    const pre = ((await db.prepare("SELECT o.id FROM orders o JOIN order_lines ol ON ol.order_id = o.id WHERE ol.is_preorder = 1 ORDER BY o.id LIMIT 1").get()) as { id: number }).id;
    await db.prepare("UPDATE orders SET status = 'CONFIRMED' WHERE id = ?").run(pre);
    await reserveForOrder(1, pre); // nothing on hand yet: the whole claim is the unbatched shortfall
    expect(((await db.prepare("SELECT COUNT(*) AS n FROM stock_reservations WHERE order_id = ? AND batch_id IS NULL AND released_at IS NULL").get(pre)) as { n: number }).n).toBe(1);
    await recordPurchase(db, { supplier_id: null, purchase_date: "2026-11-14", created_by: user, organization_id: 1, purchase_order_id: po, lines: [{ product_id: product, base_qty: 100, unit_cost_toman: 500 }] } as never);
    expect(((await db.prepare("SELECT COUNT(*) AS n FROM stock_reservations WHERE order_id = ? AND batch_id IS NULL AND released_at IS NULL").get(pre)) as { n: number }).n).toBe(0);
    expect(((await db.prepare("SELECT is_preorder FROM order_lines WHERE order_id = ?").get(pre)) as { is_preorder: number }).is_preorder).toBe(0);
    await fillPreorders(db, 1, []); // nothing to do is not an error
  });
});
