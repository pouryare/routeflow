import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-pay-alloc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const {
  recordPayment,
  replaceAllocations,
  allocationsOfPayment,
  deliveredOrdersForCustomer,
  voidPayment,
  PaymentError,
} = await import("@/lib/repo/payments");

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

describe("editing a payment's allocations by hand", () => {
  it("moves money off one order and onto another, and both caches follow", async () => {
    // 300,000 + 500,000 against a 500,000 receipt: FIFO fills the older order A completely
    // and puts the remaining 200,000 on B. My first fixture used 100,000 + 300,000, where
    // FIFO fills BOTH -- so `paid(b) === 0` was wrong about the arithmetic, not the code.
    const a = await deliveredOrder(300_000);
    const b = await deliveredOrder(500_000);
    const id = await receive(500_000);
    expect(await paid(a)).toBe(300_000);
    expect(await paid(b)).toBe(200_000);

    // The user wants it the other way round: all of it on the newer, larger order.
    await replaceAllocations(1, id, [{ order_id: b, amount_toman: 500_000 }]);

    expect(await paid(a)).toBe(0);
    expect(await paid(b)).toBe(500_000);
    const allocs = await allocationsOfPayment(1, id);
    expect(allocs).toHaveLength(1);
    expect(allocs[0].order_id).toBe(b);
  });

  it("refuses a split that does not add up, and changes nothing when it does", async () => {
    const a = await deliveredOrder(100_000);
    const id = await receive(100_000);
    await expect((async () => await replaceAllocations(1, id, [{ order_id: a, amount_toman: 60_000 }]))()).rejects.toThrow(PaymentError);
    // A half-applied allocation is worse than none, so the original stands untouched.
    expect(await allocationsOfPayment(1, id)).toEqual([{ order_id: a, amount_toman: 100_000 }]);
    expect(await paid(a)).toBe(100_000);
  });
  it("shows the on-account remainder as its own slice, not as a missing order", async () => {
    const a = await deliveredOrder(100_000);
    const id = await receive(150_000);
    await replaceAllocations(1, id, [
      { order_id: a, amount_toman: 100_000 },
      { order_id: null, amount_toman: 50_000 },
    ]);
    const allocs = await allocationsOfPayment(1, id);
    expect(allocs).toHaveLength(2);
    // order_id NULL is on-account credit, and it must survive as an explicit slice.
    expect(allocs.find((x) => x.order_id === null)!.amount_toman).toBe(50_000);
    expect(await paid(a)).toBe(100_000);
  });

  it("refuses to allocate to another customer's order", async () => {
    const mine = await deliveredOrder(100_000);
    const other = Number(
      (await getDb()
        .prepare(
          "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,'other','RESTAURANT','active','2026-01-01',1)"
        )
        .run(`C${Date.now()}o`)).lastInsertRowid
    );
    const theirs = await deliveredOrder(250_000, "2026-01-01", other);
    const id = await receive(100_000, [{ order_id: mine, amount_toman: 100_000 }]);
    await expect((async () => await replaceAllocations(1, id, [{ order_id: theirs, amount_toman: 100_000 }]))()).rejects.toThrow(PaymentError);
    expect(await paid(mine)).toBe(100_000);
    expect(await paid(theirs)).toBe(0);
  });

  it("will not over-allocate an order beyond what it is worth", async () => {
    const a = await deliveredOrder(100_000);
    const id = await receive(100_000);
    // 150,000 against an order worth 100,000: the extra 50,000 has nowhere to come from.
    await expect((async () => await replaceAllocations(1, id, [{ order_id: a, amount_toman: 150_000 }]))()).rejects.toThrow(PaymentError);
  });

  it("refuses to edit a VOIDED payment -- its allocations are gone for good", async () => {
    const a = await deliveredOrder(100_000);
    const id = await receive(100_000);
    await voidPayment(1, id, userId, "اشتباه");
    await expect((async () => await replaceAllocations(1, id, [{ order_id: a, amount_toman: 100_000 }]))()).rejects.toThrow(PaymentError);
    expect(await allocationsOfPayment(1, id)).toEqual([]);
  });

  it("lists a customer's open orders so the picker can offer them", async () => {
    const a = await deliveredOrder(100_000);
    const b = await deliveredOrder(300_000);
    const open = await deliveredOrdersForCustomer(getDb(), 1, custId);
    expect(open.map((o) => o.id)).toEqual([a, b]);
    expect(open[0].total_toman).toBe(100_000);
    expect(open[0].paid_toman).toBe(0);
  });

  it("scopes the edit to one tenant: another org's payment is not found", async () => {
    const a = await deliveredOrder(100_000);
    const id = await receive(100_000);
    await expect((async () => await replaceAllocations(2, id, [{ order_id: a, amount_toman: 100_000 }]))()).rejects.toThrow(PaymentError);
  });
});