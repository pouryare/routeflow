import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-debts-agg-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { customerDebtsForOrg } = await import("@/lib/repo/payments");
const { legacyDebtsForOrg } = await import("./helpers/legacyDebts");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const NOW = "2026-10-20T12:00:00.000Z";
const iso = (daysAgo: number) => new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();

const db = getDb();
const stamp = "2026-01-01T00:00:00.000Z";
db.prepare("INSERT OR IGNORE INTO organizations (id,name,slug,created_at) VALUES (2,'B','b',?)").run(stamp);
const owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)").run(stamp).lastInsertRowid);
const product = Number(db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','K',0.25,?,?,1)").run(stamp, stamp).lastInsertRowid);
const pkg = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(product, stamp).lastInsertRowid);

const customer = (name: string, opening = 0, org = 1) =>
  Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id,opening_balance_toman) VALUES (?,?, 'active', ?, ?, ?)").run(name, name, stamp, org, opening).lastInsertRowid);

function order(cust: number, status: string, daysAgo: number, lines: [number | null, number, number][], paid = 0, org = 1) {
  const oid = Number(
    db.prepare(
      `INSERT INTO orders (order_no,customer_id,status,order_date,delivered_at,paid_toman,created_by,created_at,updated_at,organization_id)
       VALUES ('o'||abs(random()),?,?,?,?,?,?,?,?,?)`
    ).run(cust, status, iso(daysAgo).slice(0, 10), iso(daysAgo), paid, owner, stamp, stamp, org).lastInsertRowid
  );
  for (const [delivered, ordered, price] of lines) {
    db.prepare(
      "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,?,?,?,?,1,0.25,?)"
    ).run(oid, product, pkg, ordered, delivered, price, 0, stamp);
  }
  return oid;
}

const A = customer("A", 5_000); // opening balance, one old unpaid order
const B = customer("B"); // fresh + mid-age unpaid, partly paid
const C = customer("C"); // fully paid
const D = customer("D"); // half-toman rounding, refused line (0 delivered), draft ignored
const E = customer("E"); // nothing at all
const F = customer("F", 0, 2); // another tenant

order(A, "DELIVERED", 90, [[10, 10, 1_000]]);
order(B, "DELIVERED", 3, [[4, 4, 1_000]]);
order(B, "DELIVERED", 12, [[6, 6, 1_000]], 2_000);
order(B, "PARTIALLY_DELIVERED", 40, [[2, 5, 1_000], [null, 3, 500]]);
order(C, "CLOSED", 20, [[10, 10, 700]], 7_000);
order(D, "DELIVERED", 8, [[2.5, 3, 1_001], [0, 4, 900]]); // 2.5 * 1001 = 2502.5 -> 2503; refused line = 0
order(D, "DRAFT", 1, [[null, 99, 99_999]]); // not fulfilled: must not count
order(F, "DELIVERED", 50, [[1, 1, 123]], 0, 2);

// payments + allocations (one voided)
const pay = (cust: number, amount: number, voided = false) =>
  Number(db.prepare("INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at,voided_at) VALUES (1,?,?,'CASH',?,?,?,?)").run(cust, amount, stamp, owner, stamp, voided ? stamp : null).lastInsertRowid);
const alloc = (paymentId: number, orderId: number | null, amount: number) =>
  db.prepare("INSERT INTO payment_allocations (payment_id,order_id,amount_toman,created_at) VALUES (?,?,?,?)").run(paymentId, orderId, amount, stamp);
const bOrder = (db.prepare("SELECT id FROM orders WHERE customer_id = ? ORDER BY id LIMIT 1").get(B) as { id: number }).id;
alloc(pay(B, 2_000), bOrder, 2_000);
alloc(pay(A, 1_500, true), null, 1_500); // voided: ignored
alloc(pay(A, 1_000), null, 1_000); // on-account slice

describe("customerDebtsForOrg", () => {
  it("equals the row-by-row oracle for every customer and bucket", () => {
    const got = customerDebtsForOrg(1, NOW);
    const want = legacyDebtsForOrg(db, 1, NOW);
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [id, d] of want) expect({ id, ...got.get(id)! }, `customer ${id}`).toEqual({ id, ...d });
  });

  it("keeps the other tenant out", () => {
    expect(customerDebtsForOrg(1, NOW).has(F)).toBe(false);
    expect(customerDebtsForOrg(2, NOW).get(F)?.total).toBe(123);
  });

  it("rounds a half-Toman line away from zero and ignores a refused line", () => {
    expect(customerDebtsForOrg(1, NOW).get(D)?.total).toBe(2503);
  });

  it("a customer with no orders owes only their opening balance, all of it overdue", () => {
    expect(customerDebtsForOrg(1, NOW).get(A)).toMatchObject({ bucket_30_plus: 5_000 + 10_000 });
    expect(customerDebtsForOrg(1, NOW).get(E)).toEqual({ total: 0, bucket_0_7: 0, bucket_8_30: 0, bucket_30_plus: 0 });
  });
});
