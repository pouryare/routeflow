import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-leftover-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { customerDebt, voidPayment } = await import("@/lib/repo/payments");
const { closeLeftover } = await import("@/lib/repo/leftover");
const { setThresholds, thresholdsFor } = await import("@/lib/repo/thresholds");
import type { Session } from "@/lib/session";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;
let custId = 0;

async function deliveredOrder(total: number, dateISO = "2026-01-01"): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const tag = Math.random().toString(36).slice(2);
  const orderId = Number(
    (await db
      .prepare(
        `INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,created_by,created_at,updated_at,organization_id)
         VALUES (?,?,?,'DELIVERED',?,?,?,?,1)`
      )
      .run(`o-${tag}`, custId, dateISO, dateISO, userId, now, now)).lastInsertRowid
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

beforeEach(async () => {
  const db = getDb();
  /* A cheque that settles an order goes through the payment path, which posts a
     ledger receipt whose AR leg REFERENCES customers(id). The ledger is append-only by
     trigger, so `DELETE FROM customers` below raises FOREIGN KEY constraint failed.
     Children before parents -- see tests/helpers/ledgerTeardown.ts, including its scope
     warning about never making this a global setupFiles hook. */
  await clearLedger(db);

  await db.exec(
    "DELETE FROM reminders; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM cheques; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0;"
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


const as = (role: string): Session => ({ organizationId: 1, role, user: { id: userId } }) as unknown as Session;

describe("D3 close a small leftover", () => {
  it("lets a manager close up to the limit, posts the write-off, and is not counted as money collected", async () => {
    await deliveredOrder(40_000);
    await closeLeftover(as("group_manager"), custId, 30_000, "rounding");
    expect((await customerDebt(1, custId)).total).toBe(10_000);
    const pay = (await getDb().prepare("SELECT id, method, note FROM payments WHERE customer_id = ?").get(custId)) as { id: number; method: string; note: string };
    expect(pay).toMatchObject({ method: "LEFTOVER", note: "بستن مانده: گردکردن" });
    const legs = await getDb().prepare(
      `SELECT a.code, l.side FROM journals j JOIN ledger_entries l ON l.journal_id = j.id JOIN accounts a ON a.id = l.account_id WHERE j.source_type = 'PAYMENT' AND j.source_id = ? ORDER BY l.side`
    ).all(pay.id) as { code: string; side: string }[];
    expect(legs).toEqual([{ code: "1201", side: "C" }, { code: "5110", side: "D" }]);
    await voidPayment(1, pay.id, userId, "اشتباه");
    expect((await customerDebt(1, custId)).total).toBe(40_000);
  });

  it("refuses a manager above the limit, more than is owed, or no reason; an owner may go above the limit", async () => {
    await deliveredOrder(200_000);
    await expect(closeLeftover(as("group_manager"), custId, 60_000, "rounding")).rejects.toThrow(/مالک/);
    await expect(closeLeftover(as("group_manager"), custId, 300_000, "rounding")).rejects.toThrow(/بیشتر/);
    await expect(closeLeftover(as("group_manager"), custId, 1_000, "nonsense")).rejects.toThrow(/دلیل/);
    await closeLeftover(as("owner"), custId, 60_000, "small_discount");
    expect((await customerDebt(1, custId)).total).toBe(140_000);
  });

  it("follows the limit the owner sets", async () => {
    await deliveredOrder(100_000);
    const t = await thresholdsFor(1);
    expect(t.leftover_limit_toman).toBe(50_000);
    await setThresholds(1, { ...t, leftover_limit_toman: 80_000 });
    await closeLeftover(as("group_manager"), custId, 70_000, "bank_fee");
    await setThresholds(1, t);
  });
});
