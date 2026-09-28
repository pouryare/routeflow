import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-lead-first-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { POST } = await import("@/app/api/sales/orders/route");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

/** Rule 1: a lead becomes a customer when it buys.
 *
 *  This was not a bug but a missing capability. POST /api/sales/orders required a
 *  customers.id, and a lead lives in saved_locations, so there was no path from a pin to a
 *  first order at all -- a driver who closed a sale at the door had nowhere to put it, which
 *  is why Phase 2's order task pointed at a page that could not do the job. */

let ownerId = 0;
let driverId = 0;
let groupId = 0;
let productId = 0;
let packagingId = 0;
let counter = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  groupId = Number(
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('گروه', 'lead-first', ?, 1)").run(now).lastInsertRowid
  );
  const insertUser = db.prepare(
    "INSERT INTO users (username, password_hash, display_name, role, group_id, active, created_at, organization_id) VALUES (?, 'x:y', ?, ?, ?, 1, ?, 1)"
  );
  ownerId = Number(insertUser.run("first-owner", "مالک", "owner", null, now).lastInsertRowid);
  driverId = Number(insertUser.run("first-driver", "راننده", "delivery_driver", groupId, now).lastInsertRowid);
  // kg_per_base_unit is payroll input -- commission is paid per kilogram -- so an order
  // line freezes it. A product without one would make the order's accrual meaningless.
  productId = Number(
    db.prepare("INSERT INTO products (name, sku, kg_per_base_unit, created_at, updated_at) VALUES ('کره', 'K1', 0.01, ?, ?)")
      .run(now, now).lastInsertRowid
  );
  packagingId = Number(
    db.prepare("INSERT INTO packagings (product_id, name, qty_per_pack, created_at) VALUES (?, '۱۰ گرمی', 10, ?)")
      .run(productId, now).lastInsertRowid
  );
  db.prepare("INSERT INTO product_prices (product_id, packaging_id, price_toman, valid_from, created_at) VALUES (?, ?, 10000, '2026-01-01', ?)")
    .run(productId, packagingId, now);
});

function seedLead(name: string): number {
  return Number(
    getDb()
      .prepare("INSERT INTO saved_locations (name, maps_url, lat, lng, resolution, group_id, created_at, organization_id) VALUES (?, ?, ?, 51.4, 'manual', ?, ?, 1)")
      .run(name, `https://maps.example/${name}`, 35.7 + counter++ * 0.002, groupId, new Date().toISOString()).lastInsertRowid
  );
}

function order(body: unknown, who: { uid: number; role: string; gid: number | null }) {
  return new NextRequest("http://localhost/api/sales/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: `${COOKIE_NAME}=${createSessionToken({ uid: who.uid, role: who.role as never, gid: who.gid, oid: 1, tv: 0, name: "t" })}`,
    },
    body: JSON.stringify(body),
  });
}
const DRIVER = () => ({ uid: driverId, role: "delivery_driver", gid: groupId });
// A function, not a const array: module-level code runs before beforeAll, so a `const lines`
// here captures productId and packagingId while they are still 0, and every order fails with
// "packaging not found" in a way that looks like a product bug.
const lines = () => [{ product_id: productId, packaging_id: packagingId, packs: 2 }];
const body = (lead_location_id: number) => ({
  lead_location_id,
  order_date: "2026-09-25",
  lines: lines(),
});

const customers = () => getDb().prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number };
const orders = () => getDb().prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number };

describe("a lead buys for the first time", () => {
  it("becomes a customer, and the order belongs to them", async () => {
    const lead = seedLead("هتل الف");
    const res = await POST(order(body(lead), DRIVER()));
    expect(res.status).toBe(201);
    const out = (await res.json()) as { id: number; customerId: number; promotedFromLead: boolean; leadCreated: boolean };

    expect(out.promotedFromLead).toBe(true);
    expect(out.leadCreated).toBe(true);
    // The order points at the customer the pin just became -- not at nothing, and not at a
    // second row.
    expect(orderOf(out.id).customer_id).toBe(out.customerId);
    expect(customerOfLead(lead)?.id).toBe(out.customerId);
  });

  it("leaves the pin in place -- the route it sits on must survive the sale", async () => {
    const lead = seedLead("هتل ب");
    await POST(order(body(lead), DRIVER()));
    const still = getDb().prepare("SELECT id FROM saved_locations WHERE id = ?").get(lead);
    expect(still).toBeDefined();
  });

  it("starts the customer as a lead, because the order has not been delivered yet", async () => {
    const lead = seedLead("هتل پ");
    await POST(order(body(lead), DRIVER()));
    // Rule 1 is about buying, and a DRAFT order is not yet a purchase. The lifecycle moves
    // when the delivery lands and the activity log runs -- never from the promotion.
    expect(customerOfLead(lead)?.lifecycle).toBe("lead");
  });

  it("says so in the response, so the caller can refresh the pin", async () => {
    const lead = seedLead("هتل ت");
    const res = await POST(order(body(lead), DRIVER()));
    const out = (await res.json()) as Record<string, unknown>;
    expect(out.customerId).toBeGreaterThan(0);
  });
});

describe("a van that retries", () => {
  it("lands on the same customer and the same single order, not two of each", async () => {
    const lead = seedLead("هتل ث");
    const first = await POST(order(body(lead), DRIVER()));
    const firstOut = (await first.json()) as { customerId: number; leadCreated: boolean };
    const second = await POST(order(body(lead), DRIVER()));
    const secondOut = (await second.json()) as { customerId: number; leadCreated: boolean };

    // Idempotency of the promotion. The second call must not create a second customer...
    expect(secondOut.customerId).toBe(firstOut.customerId);
    expect(secondOut.leadCreated).toBe(false);
    // ...and the two orders are two real orders, because a driver may genuinely sell twice.
    // What must not happen is a second customer, so this asserts the customer count only.
    const named = getDb().prepare("SELECT COUNT(*) AS n FROM customers WHERE lead_location_id = ?").get(lead) as { n: number };
    expect(named.n).toBe(1);
  });
});

describe("an order that fails after the promotion", () => {
  it("leaves no customer behind, so rule 1 keeps its meaning", async () => {
    // Counted as a delta, not an absolute: these tests share one database, so by now other
    // cases have placed real orders and "no orders exist" is not true of the file.
    const customersBefore = customers().n;
    const ordersBefore = orders().n;
    const lead = seedLead("هتل ج");
    // No lines: the promotion runs, then createOrder rejects the order. The customer the
    // promotion made must be put back, or the pool would gain a customer who never bought.
    const res = await POST(order({ lead_location_id: lead, order_date: "2026-09-25", lines: [] }, DRIVER()));
    expect(res.status).toBe(400);
    expect(customers().n).toBe(customersBefore);
    expect(orders().n).toBe(ordersBefore);
    // And the pin is still a pin, ready to be sold to again tomorrow.
    expect(customerOfLead(lead)).toBeUndefined();
  });
});

describe("guards", () => {
  it("refuses a lead id that is not a number", async () => {
    const res = await POST(order({ lead_location_id: "abc", order_date: "2026-09-25", lines: lines() }, DRIVER()));
    expect(res.status).toBe(400);
  });

  it("refuses a pin that does not exist", async () => {
    const res = await POST(order({ lead_location_id: 999999, order_date: "2026-09-25", lines: lines() }, DRIVER()));
    expect(res.status).toBe(404);
  });

  it("leaves the ordinary customer_id path exactly as it was", async () => {
    // A regression guard for the branch above it: naming a customer directly must not
    // suddenly promote a lead, and must still work.
    const db = getDb();
    const custId = Number(
      db.prepare("INSERT INTO customers (customer_code, business_name, city, province, lat, lng, synced_at, organization_id, group_id) VALUES ('C-1','مشتری عادی','تهران','تهران',35.9,51.5,?,1,?)")
        .run(new Date().toISOString(), groupId).lastInsertRowid
    );
    const res = await POST(order({ customer_id: custId, order_date: "2026-09-25", lines: lines() }, DRIVER()));
    expect(res.status).toBe(201);
    const out = (await res.json()) as Record<string, unknown>;
    expect(out.promotedFromLead).toBeUndefined();
    expect(orderOf(out.id as number).customer_id).toBe(custId);
  });
});

const orderOf = (id: number) => getDb().prepare("SELECT customer_id FROM orders WHERE id = ?").get(id) as { customer_id: number };
const customerOfLead = (id: number) =>
  getDb().prepare("SELECT id, customer_code, lifecycle FROM customers WHERE lead_location_id = ?").get(id) as
    | { id: number; customer_code: string; lifecycle: string }
    | undefined;
