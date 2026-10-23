import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-cust-prices-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder } = await import("@/lib/orders");
const { customerPriceHistory } = await import("@/lib/repo/customerPrices");

afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

describe("customerPriceHistory", () => {
  it("lists what the shop paid per product and pack, newest first, with the list price; drafts left out", () => {
    const db = getDb();
    ensureWarehouse(db);
    const now = new Date().toISOString();
    const owner = Number(
      db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('cp','x','م','owner',1,?,1)").run(now)
        .lastInsertRowid
    );
    const cust = Number(
      db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('CP','x','active',?,1)").run(now)
        .lastInsertRowid
    );
    const product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
    const packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 10 });
    setPrice(db, { product_id: product, price_toman: 1000, valid_from: "2026-01-01" });
    const order = (date: string) =>
      createOrder(db, {
        customer_id: cust,
        order_date: date,
        created_by: owner,
        organization_id: 1,
        salesperson_user_id: owner,
        lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
      });
    confirmOrder(db, order("2026-02-01").id);
    setPrice(db, { product_id: product, price_toman: 1200, valid_from: "2026-03-01" });
    confirmOrder(db, order("2026-03-05").id);
    order("2026-03-06"); // a draft: never charged

    const scope = { sql: " AND o.organization_id = ?", params: [1] };
    const [entry] = customerPriceHistory(scope, cust);
    expect(entry.product_name).toBe("کره");
    expect(entry.points.map((p) => p.order_date)).toEqual(["2026-03-05", "2026-02-01"]);
    expect(entry.points[0].list_price_toman).toBe(entry.points[0].unit_price_toman);
    expect(customerPriceHistory({ sql: " AND o.organization_id = ?", params: [2] }, cust)).toEqual([]);
  });
});
