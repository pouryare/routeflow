import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-orders-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { customer: 0, user: 0, product: 0, packaging: 0 };

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  ctx.customer = Number(
    db
      .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?, ?, ?)")
      .run("C1", "رستوران نمونه", now).lastInsertRowid
  );
  ctx.user = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'owner', ?)"
      )
      .run("o", "مالک", now).lastInsertRowid
  );
  ctx.product = Number(
    db
      .prepare(
        "INSERT INTO products (name, kg_per_base_unit, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run("کره گیاهی", 0.25, now, now).lastInsertRowid
  );
  ctx.packaging = Number(
    db
      .prepare(
        "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(ctx.product, "کارتن", 100, now).lastInsertRowid
  );
});

function cols(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(
    (c) => c.name
  );
}

function tableSql(table: string): string {
  return (
    getDb()
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table) as { sql: string }
  ).sql;
}

function insertOrder(orderNo: string, status = "DRAFT"): number {
  const now = new Date().toISOString();
  return Number(
    getDb()
      .prepare(
        `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status,
                             order_date, created_by, created_at, updated_at, organization_id)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(orderNo, ctx.customer, ctx.user, status, "2026-08-26", ctx.user, now, now)
      .lastInsertRowid
  );
}

describe("orders", () => {
  it("has the columns the sales module needs", () => {
    expect(cols("orders").sort()).toEqual(
      [
        // organization_id joined every tenant table once RouteFlow became multi-tenant.
        "organization_id",
        "id",
        "order_no",
        "customer_id",
        "group_id",
        "salesperson_user_id",
        "status",
        // Phase 3: the 12-state order machine plus its classifiers.
        "order_type",
        "priority",
        "offline",
        "order_date",
        "delivered_at",
        "payment_status",
        "paid_toman",
        "credit_override_by",
        // Phase 1 (Money): an order parked pending a credit_approvals decision.
        "credit_hold",
        "notes",
        "created_by",
        "created_at",
        "updated_at",
      ].sort()
    );
  });

  it("holds money as whole Toman", () => {
    expect(tableSql("orders")).toMatch(/paid_toman\s+INTEGER/);
  });

  it("refuses two orders with the same number", () => {
    insertOrder("1405-00001");
    expect(() => insertOrder("1405-00001")).toThrow();
  });

  it("refuses a status it does not know", () => {
    expect(() => insertOrder("1405-00002", "posted")).toThrow();
    expect(() => insertOrder("1405-00003", "confirmed")).toThrow(); // old lower-case is gone
  });

  it("accepts every state of the 12-state machine", () => {
    let n = 10;
    for (const status of [
      "DRAFT",
      "PENDING_REVIEW",
      "PENDING_CREDIT",
      "ON_HOLD",
      "CONFIRMED",
      "PLANNED",
      "READY",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "PARTIALLY_DELIVERED",
      "DELIVERY_FAILED",
      "CLOSED",
      "CANCELLED",
      "RETURNED",
    ]) {
      expect(() => insertOrder(`1405-00${n++}`, status)).not.toThrow();
    }
  });

  it("defaults order_type, priority and offline", () => {
    const id = insertOrder("1405-00500");
    const row = getDb()
      .prepare("SELECT order_type, priority, offline FROM orders WHERE id = ?")
      .get(id) as { order_type: string; priority: string; offline: number };
    expect(row).toEqual({ order_type: "SALE", priority: "NORMAL", offline: 0 });
  });

  it("refuses to hang off a customer that does not exist", () => {
    const now = new Date().toISOString();
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at)
           VALUES (?, ?, 'DRAFT', ?, ?, ?, ?)`
        )
        .run("1405-09999", 999999, "2026-08-26", ctx.user, now, now)
    ).toThrow();
  });
});

describe("order_lines", () => {
  it("has the columns the sales module needs", () => {
    expect(cols("order_lines").sort()).toEqual(
      [
        "id",
        "order_id",
        "product_id",
        "packaging_id",
        "packs_ordered",
        "packs_delivered",
        "unit_price_toman",
        "unit_cost_toman",
        "qty_per_pack",
        "kg_per_base_unit",
        "price_id",
        "is_reversal",
        "reverses_line_id",
        "created_at",
      ].sort()
    );
  });

  it("holds both money columns as whole Toman", () => {
    const sql = tableSql("order_lines");
    expect(sql).toMatch(/unit_price_toman\s+INTEGER/);
    expect(sql).toMatch(/unit_cost_toman\s+INTEGER/);
  });

  it("freezes the conversion factors on the line rather than referencing them", () => {
    // The whole design rests on this: qty_per_pack and kg_per_base_unit are columns on
    // the line, not joins to the catalogue. Commission is paid per kilogram, so a
    // recomputed weight is a payroll error rather than a reporting one.
    expect(cols("order_lines")).toContain("qty_per_pack");
    expect(cols("order_lines")).toContain("kg_per_base_unit");
  });

  it("goes away with its order", () => {
    const db = getDb();
    const orderId = insertOrder("1405-00100");
    db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered,
                                unit_price_toman, unit_cost_toman, qty_per_pack,
                                kg_per_base_unit, created_at)
       VALUES (?, ?, ?, 2, 440000, 300000, 100, 0.25, ?)`
    ).run(orderId, ctx.product, ctx.packaging, new Date().toISOString());

    db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM order_lines WHERE order_id = ?")
      .get(orderId) as { n: number };
    expect(left.n).toBe(0);
  });

  it("allows a negative quantity, which is how a return is recorded", () => {
    const db = getDb();
    const orderId = insertOrder("1405-00101");
    expect(() =>
      db
        .prepare(
          `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered,
                                    unit_price_toman, unit_cost_toman, qty_per_pack,
                                    kg_per_base_unit, is_reversal, created_at)
           VALUES (?, ?, ?, -2, 440000, 300000, 100, 0.25, 1, ?)`
        )
        .run(orderId, ctx.product, ctx.packaging, new Date().toISOString())
    ).not.toThrow();
  });
});

describe("customers", () => {
  it("gained a credit limit", () => {
    expect(cols("customers")).toContain("credit_limit_toman");
  });

  it("leaves the limit null, meaning no limit rather than a limit of zero", () => {
    const row = getDb()
      .prepare("SELECT credit_limit_toman FROM customers WHERE id = ?")
      .get(ctx.customer) as { credit_limit_toman: number | null };
    expect(row.credit_limit_toman).toBeNull();
  });
});
