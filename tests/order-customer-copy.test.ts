import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-ordcopy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { tehranTodayIso } = await import("@/lib/jalali");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("A12 customer copy on the order", () => {
  it("is empty before confirm, filled at confirm, and unchanged by a later customer edit", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    const user = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('oc','x','م','owner',1,?,1)").run(now)).lastInsertRowid);
    const cust = Number(
      (await db.prepare("INSERT INTO customers (customer_code,business_name,phone,address,lifecycle,synced_at,organization_id) VALUES ('CC','فروشگاه قدیم','0912','خیابان یک','active',?,1)").run(now)).lastInsertRowid
    );
    const product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    const packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
    await setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
    const o = await createOrder(db, { customer_id: cust, order_date: tehranTodayIso(), created_by: user, organization_id: 1, lines: [{ product_id: product, packaging_id: packaging, packs: 1 }] });
    const read = async () => (await db.prepare("SELECT ship_name, ship_phone, ship_address FROM orders WHERE id = ?").get(o.id)) as { ship_name: string | null; ship_phone: string | null; ship_address: string | null };
    expect((await read()).ship_name).toBeNull();
    await confirmOrder(db, o.id);
    expect(await read()).toEqual({ ship_name: "فروشگاه قدیم", ship_phone: "0912", ship_address: "خیابان یک" });
    await db.prepare("UPDATE customers SET business_name = 'نام تازه', address = 'جای دیگر' WHERE id = ?").run(cust);
    expect((await read()).ship_name).toBe("فروشگاه قدیم");
  });
});
