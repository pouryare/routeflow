import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-deliveries-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const ctx = { order: 0, line: 0, stop: 0 };

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  const cust = Number(
    db
      .prepare("INSERT INTO customers (customer_code, business_name, synced_at) VALUES (?,?,?)")
      .run("C1", "رستوران", now).lastInsertRowid
  );
  const user = Number(
    db
      .prepare(
        "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES ('o','x','م','owner',?)"
      )
      .run(now).lastInsertRowid
  );
  const prod = Number(
    db
      .prepare("INSERT INTO products (name, sku, created_at, updated_at, organization_id) VALUES ('کره','S1',?,?,1)")
      .run(now, now).lastInsertRowid
  );
  const pkg = Number(
    db
      .prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?,?,?,?)")
      .run(prod, "کارتن", 100, now).lastInsertRowid
  );
  ctx.order = Number(
    db
      .prepare(
        `INSERT INTO orders (order_no, customer_id, status, order_date, created_by, created_at, updated_at, organization_id)
         VALUES ('1405-1', ?, 'CONFIRMED', '2026-08-26', ?, ?, ?, 1)`
      )
      .run(cust, user, now, now).lastInsertRowid
  );
  ctx.line = Number(
    db
      .prepare(
        `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, unit_cost_toman, qty_per_pack, kg_per_base_unit, created_at)
         VALUES (?, ?, ?, 3, 100, 60, 100, 0.25, ?)`
      )
      .run(ctx.order, prod, pkg, now).lastInsertRowid
  );
  const run = Number(
    db
      .prepare(
        "INSERT INTO delivery_runs (driver_user_id, run_date, created_by, created_at, updated_at, organization_id) VALUES (?,?,?,?,?,1)"
      )
      .run(user, "2026-08-27", user, now, now).lastInsertRowid
  );
  ctx.stop = Number(
    db
      .prepare(
        "INSERT INTO delivery_stops (run_id, order_id, created_at) VALUES (?,?,?)"
      )
      .run(run, ctx.order, now).lastInsertRowid
  );
});

describe("deliveries schema", () => {
  it("creates deliveries and delivery_lines", () => {
    const db = getDb();
    for (const t of ["deliveries", "delivery_lines"]) {
      expect(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()).toEqual({ n: 0 });
    }
  });

  it("is unique per (order_id, seq)", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO deliveries (organization_id, order_id, seq, status, route_stop_id, created_at) VALUES (1, ?, 1, 'PLANNED', ?, ?)"
    ).run(ctx.order, ctx.stop, now);
    expect(() =>
      db
        .prepare(
          "INSERT INTO deliveries (organization_id, order_id, seq, status, created_at) VALUES (1, ?, 1, 'PLANNED', ?)"
        )
        .run(ctx.order, now)
    ).toThrow();
    // seq 2 is fine
    expect(() =>
      db
        .prepare(
          "INSERT INTO deliveries (organization_id, order_id, seq, status, created_at) VALUES (1, ?, 2, 'PLANNED', ?)"
        )
        .run(ctx.order, now)
    ).not.toThrow();
  });

  it("rejects an unknown delivery status", () => {
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO deliveries (organization_id, order_id, seq, status, created_at) VALUES (1, ?, 9, 'SHIPPED', ?)"
        )
        .run(ctx.order, new Date().toISOString())
    ).toThrow();
  });

  it("cascades delivery_lines with their delivery", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const d = Number(
      db
        .prepare(
          "INSERT INTO deliveries (organization_id, order_id, seq, status, created_at) VALUES (1, ?, 3, 'PLANNED', ?)"
        )
        .run(ctx.order, now).lastInsertRowid
    );
    db.prepare(
      "INSERT INTO delivery_lines (delivery_id, order_line_id, qty_planned) VALUES (?, ?, 300)"
    ).run(d, ctx.line);
    db.prepare("DELETE FROM deliveries WHERE id = ?").run(d);
    expect(
      (db.prepare("SELECT COUNT(*) n FROM delivery_lines WHERE delivery_id = ?").get(d) as { n: number }).n
    ).toBe(0);
  });

  it("adds delivery_id to delivery_line_batches", () => {
    const cols = (
      getDb().prepare("PRAGMA table_info(delivery_line_batches)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).toContain("delivery_id");
  });

  it("keeps deliveries on the tenant list", () => {
    expect((TENANT_TABLES as readonly string[]).includes("deliveries")).toBe(true);
  });
});
