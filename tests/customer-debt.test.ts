import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";
import { tableInfo } from "./helpers/schema";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-cust-debt-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { recordPayment, customerDebt, customerDebtsForOrg } = await import("@/lib/repo/payments");

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
      .prepare(
        "INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES (?,?,?,?,1)"
      )
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
  /* The ledger is append-only by trigger and its AR leg REFERENCES customers(id), so
     `DELETE FROM customers` below raises FOREIGN KEY constraint failed once any test in
     this file has recorded a payment. Children before parents -- see
     tests/helpers/ledgerTeardown.ts, and note the scope warning in it: many suites do not
     set ROUTEFLOW_DB_PATH, so this must stay an explicit per-suite call and never a global
     setupFiles hook, which would run against the real data/routeflow.db. */
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

describe("customerDebt", () => {
  it("is unpaid delivered orders, aged by delivered_at", async () => {
    await deliveredOrder(30_000, "2026-01-01");
    await deliveredOrder(50_000, "2026-02-25");
    const d = await customerDebt(1, custId, "2026-03-01T00:00:00Z");
    expect(d.bucket_30_plus).toBe(30_000);
    expect(d.bucket_0_7).toBe(50_000);
    expect(d.bucket_8_30).toBe(0);
    expect(d.total).toBe(80_000);
  });

  it("subtracts allocations and drops a paid order out of the buckets", async () => {
    await deliveredOrder(30_000, "2026-01-01");
    await recordPayment(1, {
      customer_id: custId,
      amount_toman: 30_000,
      method: "CASH",
      received_at: "2026-01-02",
      received_by: userId,
    });
    const d = await customerDebt(1, custId, "2026-03-01T00:00:00Z");
    expect(d.total).toBe(0);
    expect(d.bucket_30_plus).toBe(0);
  });

  it("adds an opening balance wholly into the 30-plus bucket", async () => {
    const db = getDb();
    // Task 4 adds the column; until then customerDebt treats it as 0. Simulate the
    // post-migration state by adding it here if it is absent.
    const hasCol = (await tableInfo("customers") as { name: string }[]).some(
      (c) => c.name === "opening_balance_toman"
    );
    if (!hasCol) await db.exec("ALTER TABLE customers ADD COLUMN opening_balance_toman INTEGER NOT NULL DEFAULT 0");
    await db.prepare("UPDATE customers SET opening_balance_toman = 12_000 WHERE id = ?").run(custId);
    const d = await customerDebt(1, custId, "2026-03-01T00:00:00Z");
    expect(d.total).toBe(12_000);
    expect(d.bucket_30_plus).toBe(12_000);
  });
});

describe("customerDebtsForOrg", () => {
  it("matches customerDebt for every customer", async () => {
    await deliveredOrder(40_000, "2026-01-01");
    await deliveredOrder(10_000, "2026-02-27");
    await recordPayment(1, {
      customer_id: custId,
      amount_toman: 10_000,
      method: "CASH",
      received_at: "2026-02-28",
      received_by: userId,
    });
    const asOf = "2026-03-01T00:00:00Z";
    const one = await customerDebt(1, custId, asOf);
    const all = (await customerDebtsForOrg(1, asOf)).get(custId);
    expect(all).toEqual(one);
  });
});
