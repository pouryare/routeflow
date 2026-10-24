import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sqliteOnly, tableInfo } from "./helpers/schema";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-orders-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

const ctx = { customer: 0, user: 0, product: 0, packaging: 0 };

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  ctx.customer = Number(
    (await db
      .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?, ?, ?)")
      .run("C1", "رستوران نمونه", now)).lastInsertRowid
  );
  ctx.user = Number(
    (await db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'owner', ?)"
      )
      .run("o", "مالک", now)).lastInsertRowid
  );
  ctx.product = Number(
    (await db
      .prepare(
        "INSERT INTO products (name, kg_per_base_unit, created_at, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run("کره گیاهی", 0.25, now, now)).lastInsertRowid
  );
  ctx.packaging = Number(
    (await db
      .prepare(
        "INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, ?, ?)"
      )
      .run(ctx.product, "کارتن", 100, now)).lastInsertRowid
  );
});

async function cols(table: string): Promise<string[]> {
  return (await tableInfo(table) as unknown as { name: string }[]).map(
    (c) => c.name
  );
}

async function tableSql(table: string): Promise<string> {
  return (
    await getDb()
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table) as { sql: string }
  ).sql;
}

async function insertOrder(orderNo: string, status = "DRAFT"): Promise<number> {
  const now = new Date().toISOString();
  return Number(
    (await getDb()
      .prepare(
        `INSERT INTO orders (order_no, customer_id, group_id, salesperson_user_id, status,
                             order_date, created_by, created_at, updated_at, organization_id)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(orderNo, ctx.customer, ctx.user, status, "2026-08-26", ctx.user, now, now))
      .lastInsertRowid
  );
}

describe("orders", () => {
  it("has the columns the sales module needs", async () => {
    expect((await cols("orders")).sort()).toEqual(
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
        // Phase 1 (mixed-route planning): the day the customer ASKED for, which is NOT
        // order_date — that is when the slip was typed. requested_day is nullable and its
        // NULL is the state this app calls «در اولین فرصت»: nobody has committed the order
        // to a day, and the day-splitter's raw material is exactly this set.
        // requested_kind remembers WHICH control was used, so «هفتهٔ بعد» still reads as a week
        // after it has been resolved to a concrete requested_day.
        "requested_day",
        "requested_kind",
        // Phase 4 (Offline-first): the client-generated idempotency key.
        "client_uuid",
        // Caches of what the order's lines add up to: weight in kilograms, what it was charged for
        // and what it cost (lib/repo/orderFigures.ts). Voided by triggers on order_lines whenever a
        // line changes; never a source of truth.
        "kg_total",
        "total_toman",
        "cost_toman",
        "notes",
        "created_by",
        "created_at",
        "updated_at",
      ].sort()
    );
  });

  it.skipIf(sqliteOnly)("holds money as whole Toman", async () => {
    expect(await tableSql("orders")).toMatch(/paid_toman\s+INTEGER/);
  });

  it("refuses two orders with the same number", async () => {
    await insertOrder("1405-00001");
    await expect((async () => await insertOrder("1405-00001"))()).rejects.toThrow();
  });

  it("refuses a status it does not know", async () => {
    await expect((async () => await insertOrder("1405-00002", "posted"))()).rejects.toThrow();
    await expect((async () => await insertOrder("1405-00003", "confirmed"))()).rejects.toThrow(); // old lower-case is gone
  });

  it("accepts every state of the 12-state machine", async () => {
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
      await (async () => await insertOrder(`1405-00${n++}`, status))();
    }
  });

  it("defaults order_type, priority and offline", async () => {
    const id = await insertOrder("1405-00500");
    const row = await getDb()
      .prepare("SELECT order_type, priority, offline FROM orders WHERE id = ?")
      .get(id) as { order_type: string; priority: string; offline: number };
    expect(row).toEqual({ order_type: "SALE", priority: "NORMAL", offline: 0 });
  });

  it("refuses to hang off a customer that does not exist", async () => {
    const now = new Date().toISOString();
    await expect((async () =>
      await getDb()
        .prepare(
          `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at)
           VALUES (?, ?, 'DRAFT', ?, ?, ?, ?)`
        )
        .run("1405-09999", 999999, "2026-08-26", ctx.user, now, now))()).rejects.toThrow();
  });
});

describe("order_lines", () => {
  it("has the columns the sales module needs", async () => {
    expect((await cols("order_lines")).sort()).toEqual(
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

  it.skipIf(sqliteOnly)("holds both money columns as whole Toman", async () => {
    const sql = await tableSql("order_lines");
    expect(sql).toMatch(/unit_price_toman\s+INTEGER/);
    expect(sql).toMatch(/unit_cost_toman\s+INTEGER/);
  });

  it("freezes the conversion factors on the line rather than referencing them", async () => {
    // The whole design rests on this: qty_per_pack and kg_per_base_unit are columns on
    // the line, not joins to the catalogue. Commission is paid per kilogram, so a
    // recomputed weight is a payroll error rather than a reporting one.
    expect(await cols("order_lines")).toContain("qty_per_pack");
    expect(await cols("order_lines")).toContain("kg_per_base_unit");
  });

  it("goes away with its order", async () => {
    const db = getDb();
    const orderId = await insertOrder("1405-00100");
    await db.prepare(
      `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered,
                                unit_price_toman, unit_cost_toman, qty_per_pack,
                                kg_per_base_unit, created_at)
       VALUES (?, ?, ?, 2, 440000, 300000, 100, 0.25, ?)`
    ).run(orderId, ctx.product, ctx.packaging, new Date().toISOString());

    await db.prepare("DELETE FROM orders WHERE id = ?").run(orderId);
    const left = await db
      .prepare("SELECT COUNT(*) AS n FROM order_lines WHERE order_id = ?")
      .get(orderId) as { n: number };
    expect(left.n).toBe(0);
  });

  it("allows a negative quantity, which is how a return is recorded", async () => {
    const db = getDb();
    const orderId = await insertOrder("1405-00101");
    await (async () =>
      await db
        .prepare(
          `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered,
                                    unit_price_toman, unit_cost_toman, qty_per_pack,
                                    kg_per_base_unit, is_reversal, created_at)
           VALUES (?, ?, ?, -2, 440000, 300000, 100, 0.25, 1, ?)`
        )
        .run(orderId, ctx.product, ctx.packaging, new Date().toISOString()))();
  });
});

describe("customers", () => {
  it("gained a credit limit", async () => {
    expect(await cols("customers")).toContain("credit_limit_toman");
  });

  it("leaves the limit null, meaning no limit rather than a limit of zero", async () => {
    const row = await getDb()
      .prepare("SELECT credit_limit_toman FROM customers WHERE id = ?")
      .get(ctx.customer) as { credit_limit_toman: number | null };
    expect(row.credit_limit_toman).toBeNull();
  });
});
