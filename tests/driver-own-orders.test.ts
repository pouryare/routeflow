import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Session } from "@/lib/session";

const testDbPath = path.join(os.tmpdir(), `rf-ownorders-${Date.now()}-${process.pid}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { orderFilter } = await import("@/lib/session");
const { readOrders } = await import("@/lib/orders");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = () => new Date().toISOString();
const ctx = { driverA: 0, driverB: 0, customer: 0, product: 0, packaging: 0 };

const sess = (id: number, role: string): Session =>
  ({
    user: { id } as never,
    role: role as never,
    groupId: null,
    organizationId: 1,
    roles: [role] as Session["roles"],
    hasRole: (x) => x === role,
  }) as Session;

/** A confirmed order authored by `author`, not on any run. */
function orderBy(author: number, tag: string): number {
  const db = getDb();
  const oid = Number(
    db.prepare(
      "INSERT INTO orders (order_no, customer_id, order_date, status, created_by, salesperson_user_id, organization_id, created_at, updated_at) VALUES (?, ?, ?, 'CONFIRMED', ?, ?, 1, ?, ?)",
    ).run(`OWN-${tag}-${process.pid}`, ctx.customer, iso().slice(0, 10), author, author, iso(), iso()).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO order_lines (order_id, product_id, packaging_id, packs_ordered, unit_price_toman, qty_per_pack, kg_per_base_unit, created_at)
     VALUES (?, ?, ?, 1, 100000, 6, 2, ?)`,
  ).run(oid, ctx.product, ctx.packaging, iso());
  return oid;
}

beforeAll(() => {
  const db = getDb();
  ctx.driverA = Number(
    db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'delivery_driver', ?)")
      .run(`drva-${process.pid}`, "راننده الف", iso()).lastInsertRowid,
  );
  ctx.driverB = Number(
    db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'delivery_driver', ?)")
      .run(`drvb-${process.pid}`, "راننده ب", iso()).lastInsertRowid,
  );
  ctx.customer = Number(
    db.prepare("INSERT INTO customers (customer_code, business_name, lat, lng, synced_at, organization_id) VALUES (?, ?, 35.7, 51.4, ?, 1)")
      .run(`C-OWN-${process.pid}`, "مشتری", iso()).lastInsertRowid,
  );
  ctx.product = Number(
    db.prepare("INSERT INTO products (name, kg_per_base_unit, organization_id, created_at, updated_at) VALUES (?, 2, 1, ?, ?)")
      .run("کالا", iso(), iso()).lastInsertRowid,
  );
  ctx.packaging = Number(
    db.prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, ?, 6, ?)")
      .run(ctx.product, "بسته", iso()).lastInsertRowid,
  );
});

describe("a driver sees the orders they placed themselves", () => {
  it("shows an order authored in the field, with no run attached", () => {
    // THE DEFECT, recorded in app/api/sales/orders/route.ts:20-23 before this phase:
    // "an order a driver places from a lead will not appear in this list until it is on a
    // delivery run... deliberately not changed here."
    //
    // So a driver standing in a shop writes a sale, sees it succeed, and then cannot find it —
    // for them or for the office — until a manager loads it onto a van. Reported as "it didn't
    // save", on a row that saved perfectly.
    const oid = orderBy(ctx.driverA, "field-sale");
    const visible = readOrders(getDb(), orderFilter(sess(ctx.driverA, "delivery_driver")), { limit: 200 });
    expect(visible.map((o) => o.id)).toContain(oid);
  });

  it("shows it for a field rep too, because they wear the same hat", () => {
    const rep = Number(
      getDb().prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'field_rep', ?)")
        .run(`rep-${process.pid}`, "ویزیتور", iso()).lastInsertRowid,
    );
    const oid = orderBy(rep, "rep-sale");
    const visible = readOrders(getDb(), orderFilter(sess(rep, "field_rep")), { limit: 200 });
    expect(visible.map((o) => o.id)).toContain(oid);
  });

  it("does NOT show another driver's order", () => {
    // The authorship rule must be an OR, not a replacement: adding "mine" must not stop the
    // runs-based rule that lets a driver reprint yesterday's receipt.
    const other = orderBy(ctx.driverB, "other-sale");
    const mine = readOrders(getDb(), orderFilter(sess(ctx.driverA, "delivery_driver")), { limit: 200 });
    expect(mine.map((o) => o.id)).not.toContain(other);
  });

  it("still shows orders delivered on a run that the driver did not author", () => {
    // The other half of the OR: an office-placed order on their van is still their work, and
    // cutting it off would break receipt reprints.
    const db = getDb();
    const office = Number(
      db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, 'x', ?, 'owner', ?)")
        .run(`ownr-${process.pid}`, "مالک", iso()).lastInsertRowid,
    );
    const oid = orderBy(office, "office-on-run");
    const runId = Number(
      db.prepare(
        "INSERT INTO delivery_runs (driver_user_id, run_date, status, created_by, organization_id, created_at, updated_at) VALUES (?, '2026-01-02', 'planned', ?, 1, ?, ?)",
      ).run(ctx.driverA, office, iso(), iso()).lastInsertRowid,
    );
    db.prepare("INSERT INTO delivery_stops (run_id, order_id, sort_order, status, created_at) VALUES (?, ?, 0, 'pending', ?)")
      .run(runId, oid, iso());

    const mine = readOrders(getDb(), orderFilter(sess(ctx.driverA, "delivery_driver")), { limit: 200 });
    expect(mine.map((o) => o.id)).toContain(oid);
  });
});