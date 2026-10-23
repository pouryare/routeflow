import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-order-submit-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
await ensureWarehouse(getDb());
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, submitOrder, OrderError } = await import("@/lib/orders");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let custId = 0;
let product = 0;
let packaging = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM credit_approvals; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  owner = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,'owner',?,1)"
      )
      .run(`o${Date.now()}`, "x:y", "م", now)).lastInsertRowid
  );
  custId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES (?,?,'active','2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x")).lastInsertRowid
  );
  product = await createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = await createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  await setPrice(db, { product_id: product, price_toman: 20_000, valid_from: "2026-01-01" });
});

async function newOrder(): Promise<number> {
  return (await createOrder(getDb(), {
    customer_id: custId,
    order_date: "2026-01-01",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 1 }],
  })).id;
}

describe("submitOrder", () => {
  it("writes a 'create' event when the order is born", async () => {
    const id = await newOrder();
    const ev = await getDb()
      .prepare("SELECT from_status, to_status, action FROM order_events WHERE order_id = ?")
      .all(id) as { from_status: string | null; to_status: string; action: string }[];
    expect(ev).toEqual([{ from_status: null, to_status: "DRAFT", action: "create" }]);
  });

  it("leaves an under-limit direct order at PENDING_REVIEW", async () => {
    const id = await newOrder();
    expect(await submitOrder(1, id, { id: owner, role: "phone_sales" })).toBe("PENDING_REVIEW");
  });

  it("auto-confirms a SAMPLE order on submit", async () => {
    const id = await newOrder();
    await getDb().prepare("UPDATE orders SET order_type = 'SAMPLE' WHERE id = ?").run(id);
    expect(await submitOrder(1, id, { id: owner, role: "phone_sales" })).toBe("CONFIRMED");
  });

  it("refuses to submit an order with no lines", async () => {
    const db = getDb();
    const id = await newOrder();
    await db.exec(`DELETE FROM order_lines WHERE order_id = ${id}`);
    await expect((async () => await submitOrder(1, id, { id: owner, role: "phone_sales" }))()).rejects.toThrow(OrderError);
  });

  it("refuses a second submit", async () => {
    const id = await newOrder();
    await submitOrder(1, id, { id: owner, role: "phone_sales" });
    await expect((async () => await submitOrder(1, id, { id: owner, role: "phone_sales" }))()).rejects.toThrow(OrderError);
  });
});
