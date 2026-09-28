import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-credit-state-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, submitOrder } = await import("@/lib/orders");
const { decide } = await import("@/lib/repo/creditApprovals");
const { advanceOrder } = await import("@/lib/repo/orders");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let custId = 0;
let product = 0;
let packaging = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM stock_movements; DELETE FROM batches; DELETE FROM credit_approvals; DELETE FROM reminders; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  owner = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,'owner',?,1)"
      )
      .run(`o${Date.now()}`, "x:y", "م", now).lastInsertRowid
  );
  custId = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,lifecycle,credit_limit_toman,synced_at,organization_id) VALUES (?,?,'active',10000,'2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x").lastInsertRowid
  );
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: product, price_toman: 20_000, valid_from: "2026-01-01" });
  // stock to reserve against
  const fac = Number(
    db
      .prepare(
        "INSERT INTO facilities (slug,kind,name,lat,lng,updated_at,organization_id,created_at) VALUES ('w','warehouse','ا',0,0,?,1,?)"
      )
      .run(now, now).lastInsertRowid
  );
  const b = Number(
    db
      .prepare(
        "INSERT INTO batches (organization_id,product_id,batch_code,expiry_date,qty_received_base,unit_cost_toman,status,created_at,updated_at) VALUES (1,?,?,?,1000,0,'active',?,?)"
      )
      .run(product, "B1", "2026-06-01", now, now).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO stock_movements (organization_id,facility_id,product_id,batch_id,base_qty,kind,occurred_at,created_at) VALUES (1,?,?,?,1000,'PURCHASE_IN',?,?)"
  ).run(fac, product, b, now, now);
});

function overLimitOrder(): number {
  const id = createOrder(getDb(), {
    customer_id: custId,
    order_date: "2026-02-01",
    created_by: owner,
    organization_id: 1,
    lines: [{ product_id: product, packaging_id: packaging, packs: 1 }], // 20_000 > 10_000
  }).id;
  submitOrder(1, id, { id: owner, role: "phone_sales" });
  return id;
}

describe("credit approval drives the order machine", () => {
  it("approve -> CONFIRMED and stock is reserved", () => {
    const db = getDb();
    const id = overLimitOrder();
    const approvalId = (db.prepare("SELECT id FROM credit_approvals WHERE order_id=?").get(id) as { id: number }).id;
    decide(1, approvalId, "approved", owner);
    expect((db.prepare("SELECT status FROM orders WHERE id=?").get(id) as { status: string }).status).toBe("CONFIRMED");
    const res = db
      .prepare("SELECT COUNT(*) AS n FROM stock_reservations WHERE order_id=? AND released_at IS NULL")
      .get(id) as { n: number };
    expect(res.n).toBe(1);
  });

  it("reject -> ON_HOLD, then releaseHold -> CONFIRMED", () => {
    const db = getDb();
    const id = overLimitOrder();
    const approvalId = (db.prepare("SELECT id FROM credit_approvals WHERE order_id=?").get(id) as { id: number }).id;
    decide(1, approvalId, "rejected", owner);
    expect((db.prepare("SELECT status FROM orders WHERE id=?").get(id) as { status: string }).status).toBe("ON_HOLD");
    advanceOrder(1, id, "releaseHold", { id: owner, role: "group_manager" });
    const row = db.prepare("SELECT status, credit_hold FROM orders WHERE id=?").get(id) as {
      status: string;
      credit_hold: number;
    };
    expect(row).toMatchObject({ status: "CONFIRMED", credit_hold: 0 });
  });

  it("refuses to decide the same approval twice", () => {
    const db = getDb();
    const id = overLimitOrder();
    const approvalId = (db.prepare("SELECT id FROM credit_approvals WHERE order_id=?").get(id) as { id: number }).id;
    decide(1, approvalId, "approved", owner);
    expect(() => decide(1, approvalId, "rejected", owner)).toThrow();
  });
});
