import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-order-events-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { order: 0, user: 0 };

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const customer = Number(
    db
      .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?,?,?)")
      .run("C1", "رستوران", now).lastInsertRowid
  );
  ctx.user = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'owner', ?)"
      )
      .run("o", "مالک", now).lastInsertRowid
  );
  ctx.order = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id)
         VALUES ('1405-1', ?, 'DRAFT', '2026-08-26', ?, ?, ?, 1)`
      )
      .run(customer, ctx.user, now, now).lastInsertRowid
  );
});

describe("order_events", () => {
  it("exists and starts empty for a hand-inserted order", () => {
    const n = getDb()
      .prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?")
      .get(ctx.order) as { n: number };
    expect(n.n).toBe(0);
  });

  it("accepts an append with a null from_status", () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO order_events
             (organization_id, order_id, from_status, to_status, action, actor_user_id, created_at)
           VALUES (1, ?, NULL, 'DRAFT', 'create', ?, ?)`
        )
        .run(ctx.order, ctx.user, new Date().toISOString())
    ).not.toThrow();
  });

  it("cascades away with its order", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const cust = Number(
      db
        .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?,?,?)")
        .run("C2", "کافه", now).lastInsertRowid
    );
    const oid = Number(
      db
        .prepare(
          `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id)
           VALUES ('1405-2', ?, 'DRAFT', '2026-08-26', ?, ?, ?, 1)`
        )
        .run(cust, ctx.user, now, now).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO order_events (organization_id, order_id, to_status, action, created_at)
       VALUES (1, ?, 'DRAFT', 'create', ?)`
    ).run(oid, now);
    db.prepare("DELETE FROM orders WHERE id = ?").run(oid);
    const left = db
      .prepare("SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?")
      .get(oid) as { n: number };
    expect(left.n).toBe(0);
  });

  it("refuses a foreign-key-less order id", () => {
    expect(() =>
      getDb()
        .prepare(
          `INSERT INTO order_events (organization_id, order_id, to_status, action, created_at)
           VALUES (1, 999999, 'DRAFT', 'create', ?)`
        )
        .run(new Date().toISOString())
    ).toThrow();
  });
});
