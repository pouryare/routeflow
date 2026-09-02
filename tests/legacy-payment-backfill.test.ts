import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-legacy-backfill-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, backfillLegacyPayments } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userId = 0;
let custId = 0;

/** An order carrying a pre-Phase-1 paid_toman set by hand, with one line worth `total`. */
function legacyPaidOrder(paid: number, total: number, dateISO = "2026-01-01"): number {
  const db = getDb();
  const now = new Date().toISOString();
  const tag = Math.random().toString(36).slice(2);
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no,customer_id,order_date,status,delivered_at,paid_toman,payment_status,created_by,created_at,updated_at,organization_id)
         VALUES (?,?,?,'delivered',?,?,?,?,?,?,1)`
      )
      .run(`o-${tag}`, custId, dateISO, dateISO, paid, "partial", userId, now, now).lastInsertRowid
  );
  const productId = Number(
    db
      .prepare("INSERT INTO products (name,sku,created_at,updated_at,organization_id) VALUES (?,?,?,?,1)")
      .run(`p${tag}`, `s${tag}`, now, now).lastInsertRowid
  );
  const packId = Number(
    db
      .prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,?,1,?)")
      .run(productId, "box", now).lastInsertRowid
  );
  db.prepare(
    `INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,is_reversal,created_at)
     VALUES (?,?,?,1,1,?,0,1,1,0,?)`
  ).run(orderId, productId, packId, total, now);
  return orderId;
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id > 0; DELETE FROM app_meta WHERE key = 'legacy_payment_backfill_done';"
  );
  const now = new Date().toISOString();
  userId = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,'group_manager',NULL,1,?,1)"
      )
      .run(`u${Date.now()}`, "x:y", "م", now).lastInsertRowid
  );
  custId = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active','2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x").lastInsertRowid
  );
});

describe("backfillLegacyPayments", () => {
  it("creates one synthetic CASH payment per pre-existing paid order, once", () => {
    const db = getDb();
    const o1 = legacyPaidOrder(12_000, 12_000);
    backfillLegacyPayments(db);
    const pays = db.prepare("SELECT * FROM payments").all() as { id: number; amount_toman: number; method: string }[];
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amount_toman: 12_000, method: "CASH" });
    expect(
      db.prepare("SELECT order_id, amount_toman FROM payment_allocations WHERE payment_id = ?").get(pays[0].id)
    ).toMatchObject({ order_id: o1, amount_toman: 12_000 });

    backfillLegacyPayments(db); // idempotent
    expect(db.prepare("SELECT COUNT(*) n FROM payments").get()).toEqual({ n: 1 });
  });

  it("caps a synthetic payment at the order's line total and notes it", () => {
    const db = getDb();
    legacyPaidOrder(15_000, 10_000);
    backfillLegacyPayments(db);
    const pay = db.prepare("SELECT amount_toman, note FROM payments").get() as {
      amount_toman: number;
      note: string;
    };
    expect(pay.amount_toman).toBe(10_000);
    expect(pay.note).toContain("سقف");
  });

  it("leaves an order that already has an allocation alone", () => {
    const db = getDb();
    const o1 = legacyPaidOrder(5_000, 5_000);
    const now = new Date().toISOString();
    const pid = Number(
      db
        .prepare(
          "INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at) VALUES (1,?,5000,'POS','x',?,?)"
        )
        .run(custId, userId, now).lastInsertRowid
    );
    db.prepare("INSERT INTO payment_allocations (payment_id,order_id,amount_toman,created_at) VALUES (?,?,5000,?)").run(
      pid,
      o1,
      now
    );
    backfillLegacyPayments(db);
    expect(db.prepare("SELECT COUNT(*) n FROM payments").get()).toEqual({ n: 1 });
  });
});
