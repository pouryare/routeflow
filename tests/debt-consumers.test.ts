import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { clearLedger } from "./helpers/ledgerTeardown";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-debt-consumers-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { salesDashboard } = await import("@/lib/dashboard");
const { recordPayment } = await import("@/lib/repo/payments");
import type { Session } from "@/lib/session";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;
let custId = 0;

const ownerSession = (): Session =>
  ({ user: { id: userId } as never, role: "owner" as never, groupId: null, organizationId: 1, roles: ["owner"], hasRole: (x) => x === "owner" });

async function deliveredOrder(total: number, dateISO: string): Promise<number> {
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
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'owner',NULL,1,?,1)"
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

describe("salesDashboard debt", () => {
  it("ages an old unpaid delivered order into the 30-plus bucket", async () => {
    await deliveredOrder(40_000, "2026-01-01");
    const dash = await salesDashboard(getDb(), ownerSession());
    expect(dash.debt.over_30).toBe(40_000);
    expect(dash.debt.d0_7).toBe(0);
    expect(dash.debt.total).toBe(40_000);
  });

  it("drops the order out of the buckets once a payment settles it", async () => {
    await deliveredOrder(40_000, "2026-01-01");
    await recordPayment(1, {
      customer_id: custId,
      amount_toman: 40_000,
      method: "CASH",
      received_at: "2026-01-05",
      received_by: userId,
    });
    const dash = await salesDashboard(getDb(), ownerSession());
    expect(dash.debt.over_30).toBe(0);
    expect(dash.debt.total).toBe(0);
  });
});
