import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-on-account-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  recordPayment,
  PaymentError,
} = await import("@/lib/repo/payments");
const { onAccountCredit, applyCreditToOrder } = await import("@/lib/repo/onAccount");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;
let custId = 0;

/** A delivered order worth `total` Toman: one line, price = total, one pack. */
async function deliveredOrder(total: number, dateISO = "2026-01-01", customer = 0): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const tag = Math.random().toString(36).slice(2);
  const orderId = Number(
    (await db
      .prepare(
        `INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id)
         VALUES (?,?,?,'DELIVERED',?,?,?,?,1)`
      )
      .run(`o-${tag}`, customer || custId, dateISO, dateISO, userId, now, now)).lastInsertRowid
  );
  const productId = Number(
    (await db
      .prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES (?,?,?,?,1)")
      .run(`p${tag}`, `s${tag}`, now, now)).lastInsertRowid
  );
  const packId = Number(
    (await db
      .prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,?,1,?)")
      .run(productId, "box", now)).lastInsertRowid
  );
  await db.prepare(
    `INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at)
     VALUES (?,?,?,1,1,?,0,1,1,0,?)`
  ).run(orderId, productId, packId, total, now);
  return orderId;
}

const paid = async (orderId: number) =>
  Number(
    (await getDb().prepare("SELECT paid_toman FROM orders WHERE id = ?").get(orderId) as {
      paid_toman: number;
    }).paid_toman
  );

const receive = async (amount: number, allocations?: { order_id: number | null; amount_toman: number }[]) =>
  await recordPayment(1, {
    customer_id: custId,
    amount_toman: amount,
    method: "CASH",
    received_at: "2026-01-05",
    received_by: userId,
    ...(allocations ? { allocations } : {}),
  });

beforeEach(async () => {
  const db = getDb();
  // Ledger first: it is append-only by trigger and its AR leg holds a real FK to
  // customers(id), so it cannot be deleted and blocks the DELETE below.
  await clearLedger(db);
  await db.exec(
    "DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  userId = Number(
    (await db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run(`u${Date.now()}`, "x:y", "م", now)).lastInsertRowid
  );
  custId = Number(
    (await db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x")).lastInsertRowid
  );
});

describe("on-account credit (F63)", () => {
  it("moves credit onto an unpaid delivered order, splitting a slice when the order owes less", async () => {
    await receive(500_000); // nothing owed yet: all of it sits on account
    expect(await onAccountCredit(1, custId)).toBe(500_000);
    const order = await deliveredOrder(200_000);
    expect(await applyCreditToOrder(1, order)).toBe(200_000);
    expect(await paid(order)).toBe(200_000);
    expect(await onAccountCredit(1, custId)).toBe(300_000);
  });
  it("refuses an order that owes nothing, and a customer with no credit", async () => {
    const order = await deliveredOrder(100_000);
    await expect(applyCreditToOrder(1, order)).rejects.toBeInstanceOf(PaymentError);
    await receive(100_000);
    expect(await paid(order)).toBe(100_000);
    await expect(applyCreditToOrder(1, order)).rejects.toThrow();
  });
});
