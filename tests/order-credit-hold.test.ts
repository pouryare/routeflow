import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-credit-hold-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
const { createProduct, createPackaging, setPrice } = await import("@/lib/catalogue");
const { createOrder, confirmOrder, submitOrder, OrderError } = await import("@/lib/orders");
const { createRun, addStop, DeliveryError } = await import("@/lib/delivery");
const { decide } = await import("@/lib/repo/creditApprovals");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let owner = 0;
let driver = 0;
let custId = 0;
let product = 0;
let packaging = 0;

function line(packs: number) {
  return { product_id: product, packaging_id: packaging, packs };
}

beforeEach(() => {
  const db = getDb();
  db.exec(
    "DELETE FROM order_events; DELETE FROM stock_reservations; DELETE FROM credit_approvals; DELETE FROM representative_profiles; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM deliveries; DELETE FROM delivery_stops; DELETE FROM delivery_runs; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM facilities; DELETE FROM users WHERE id > 0;"
  );
  const now = new Date().toISOString();
  const u = db.prepare(
    "INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,NULL,1,?,1)"
  );
  owner = Number(u.run(`o${Date.now()}`, "x:y", "م", "owner", now).lastInsertRowid);
  driver = Number(u.run(`d${Date.now()}`, "x:y", "ر", "delivery_driver", now).lastInsertRowid);
  custId = Number(
    db
      .prepare(
        "INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,credit_limit_toman,synced_at,organization_id) VALUES (?,?,'RESTAURANT','active',50000,'2026-01-01',1)"
      )
      .run(`C${Date.now()}`, "x").lastInsertRowid
  );
ensureWarehouse(getDb());
  product = createProduct(db, { name: "کره", kg_per_base_unit: 0.25, organization_id: 1 });
  packaging = createPackaging(db, { product_id: product, name: "جعبه", qty_per_pack: 100 });
  setPrice(db, { product_id: product, price_toman: 20_000, valid_from: "2026-01-01" });
});

function deliveredUnpaidOrder(packs: number): number {
  const db = getDb();
  const o = createOrder(db, {
    customer_id: custId,
    order_date: "2026-01-01",
    created_by: owner,
    organization_id: 1,
    lines: [line(packs)],
  });
  confirmOrder(db, o.id);
  db.prepare("UPDATE orders SET status = 'DELIVERED', delivered_at = '2026-01-02' WHERE id = ?").run(o.id);
  return o.id;
}

describe("submitOrder credit hold", () => {
  it("holds a direct order that breaches the limit and files an approval", () => {
    const db = getDb();
    deliveredUnpaidOrder(2); // 40_000 outstanding, limit 50_000
    const { id } = createOrder(db, {
      customer_id: custId,
      order_date: "2026-02-01",
      created_by: owner,
      organization_id: 1,
      lines: [line(1)], // +20_000 -> 60_000 > 50_000
    });
    // born clean; the breach is caught on submit
    expect((db.prepare("SELECT credit_hold FROM orders WHERE id=?").get(id) as { credit_hold: number }).credit_hold).toBe(0);
    const after = submitOrder(1, id, { id: owner, role: "phone_sales" });
    expect(after).toBe("PENDING_CREDIT");
    expect(
      db.prepare("SELECT credit_hold, status FROM orders WHERE id=?").get(id)
    ).toMatchObject({ credit_hold: 1, status: "PENDING_CREDIT" });
    expect(db.prepare("SELECT COUNT(*) n FROM credit_approvals WHERE order_id=?").get(id)).toEqual({ n: 1 });

    const run = createRun(db, { driver_user_id: driver, run_date: "2026-02-02", created_by: owner, organization_id: 1 });
    expect(() => addStop(db, run, id)).toThrow(DeliveryError);
  });

  it("does not hold an order within the limit", () => {
    const db = getDb();
    const { id } = createOrder(db, {
      customer_id: custId,
      order_date: "2026-02-01",
      created_by: owner,
      organization_id: 1,
      lines: [line(1)], // 20_000 < 50_000
    });
    expect(submitOrder(1, id, { id: owner, role: "phone_sales" })).toBe("PENDING_REVIEW");
    expect((db.prepare("SELECT credit_hold FROM orders WHERE id=?").get(id) as { credit_hold: number }).credit_hold).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM credit_approvals").get()).toEqual({ n: 0 });
  });

  it("never holds a representative's order -- it goes straight to CONFIRMED", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO representative_profiles (organization_id, customer_id, rep_code, stage, credit_terms_days, created_at, updated_at) VALUES (1,?,'R1','active',0,?,?)"
    ).run(custId, now, now);
    deliveredUnpaidOrder(3); // 60_000 outstanding, over the limit
    const { id } = createOrder(db, {
      customer_id: custId,
      order_date: "2026-02-01",
      created_by: owner,
      organization_id: 1,
      lines: [line(2)],
    });
    expect(submitOrder(1, id, { id: owner, role: "phone_sales" })).toBe("CONFIRMED");
    expect((db.prepare("SELECT credit_hold FROM orders WHERE id=?").get(id) as { credit_hold: number }).credit_hold).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM credit_approvals").get()).toEqual({ n: 0 });
  });

  it("refuses a hard-blocked customer at creation", () => {
    const db = getDb();
    db.prepare("UPDATE customers SET hard_credit_block = 1 WHERE id = ?").run(custId);
    expect(() =>
      createOrder(db, {
        customer_id: custId,
        order_date: "2026-02-01",
        created_by: owner,
        organization_id: 1,
        lines: [line(1)],
      })
    ).toThrow(OrderError);
    expect(db.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({ n: 0 });
  });

  it("decide('approved') releases the hold", () => {
    const db = getDb();
    deliveredUnpaidOrder(2);
    const { id } = createOrder(db, {
      customer_id: custId,
      order_date: "2026-02-01",
      created_by: owner,
      organization_id: 1,
      lines: [line(1)],
    });
    submitOrder(1, id, { id: owner, role: "phone_sales" });
    const approvalId = (db.prepare("SELECT id FROM credit_approvals WHERE order_id=?").get(id) as { id: number }).id;
    decide(1, approvalId, "approved", owner);
    const row = db.prepare("SELECT credit_hold, status FROM orders WHERE id=?").get(id) as {
      credit_hold: number;
      status: string;
    };
    expect(row.credit_hold).toBe(0);
    expect(row.status).toBe("CONFIRMED");
  });

  it("raises a manager reminder when an order is flagged for credit", () => {
    const db = getDb();
    deliveredUnpaidOrder(2);
    const { id } = createOrder(db, {
      customer_id: custId,
      order_date: "2026-02-01",
      created_by: owner,
      organization_id: 1,
      lines: [line(1)],
    });
    submitOrder(1, id, { id: owner, role: "phone_sales" });
    const n = db
      .prepare("SELECT COUNT(*) AS n FROM reminders WHERE entity_type='customer' AND entity_id=?")
      .get(custId) as { n: number };
    expect(n.n).toBe(1);
  });

  it("rejecting a credit approval parks the order ON_HOLD", () => {
    const db = getDb();
    deliveredUnpaidOrder(2);
    const { id } = createOrder(db, {
      customer_id: custId,
      order_date: "2026-02-01",
      created_by: owner,
      organization_id: 1,
      lines: [line(1)],
    });
    submitOrder(1, id, { id: owner, role: "phone_sales" });
    const approvalId = (db.prepare("SELECT id FROM credit_approvals WHERE order_id=?").get(id) as { id: number }).id;
    decide(1, approvalId, "rejected", owner);
    expect((db.prepare("SELECT status FROM orders WHERE id=?").get(id) as { status: string }).status).toBe("ON_HOLD");
  });
});
