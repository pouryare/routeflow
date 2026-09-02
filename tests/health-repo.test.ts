import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-health-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { customerHealthFor, customersHealthOverview, materialiseHealth } = await import("@/lib/repo/health");
const { snapshot } = await import("@/lib/repo/kpiSnapshots");
const { periodOf } = await import("@/lib/analysis/period");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const PERIOD = periodOf(new Date().toISOString());

function session(role: Role, uid: number, gid: number | null): Session {
  return { user: { id: uid, role, group_id: gid, organization_id: 1 } as UserRow, role, groupId: gid, organizationId: 1 };
}

let gEast = 0;
let gWest = 0;
let owner = 0;
let eastMgr = 0;
let steady = 0;
let lapsed = 0;
let westCust = 0;
let product = 0;
let pkg = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM kpi_snapshots; DELETE FROM payment_allocations; DELETE FROM payments; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM quality_complaints; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; DELETE FROM groups; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  gEast = Number(db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('شرق','e',?,1)").run(now).lastInsertRowid);
  gWest = Number(db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('غرب','w',?,1)").run(now).lastInsertRowid);
  owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)").run(now).lastInsertRowid);
  eastMgr = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('em','x','م','group_manager',?,?,1)").run(gEast, now).lastInsertRowid);
  steady = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('S','منظم','active',?,?,1)").run(now, gEast).lastInsertRowid);
  lapsed = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('L','رهاشده','active',?,?,1)").run(now, gEast).lastInsertRowid);
  westCust = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('W','غربی','active',?,?,1)").run(now, gWest).lastInsertRowid);
  product = Number(db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','K',0.25,?,?,1)").run(now, now).lastInsertRowid);
  pkg = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(product, now).lastInsertRowid);
});

function order(customerId: number, dateIso: string, status: string, packs: number, price: number, cost: number, deliveredAt?: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const oid = Number(
    db.prepare(
      "INSERT INTO orders (order_no,customer_id,group_id,status,order_date,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,?,?,?,?,?,?,?,1)"
    ).run(customerId, gEast, status, dateIso.slice(0, 10), deliveredAt ?? null, owner, now, now).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,?,?,?,?,1,0.25,?)"
  ).run(oid, product, pkg, packs, packs, price, cost, now);
  return oid;
}

describe("health repo", () => {
  it("a steady, paid-up customer is good", () => {
    order(steady, iso(38), "DELIVERED", 10, 1000, 800, iso(38));
    order(steady, iso(24), "DELIVERED", 10, 1000, 800, iso(24));
    order(steady, iso(10), "DELIVERED", 10, 1000, 800, iso(10));
    // pay them off so there is no overdue
    const db = getDb();
    const pid = Number(
      db.prepare("INSERT INTO payments (organization_id,customer_id,amount_toman,method,received_at,received_by,created_at) VALUES (1,?,30000,'CASH',?,?,?)").run(steady, iso(5), owner, iso(5)).lastInsertRowid
    );
    for (const o of db.prepare("SELECT id FROM orders WHERE customer_id=?").all(steady) as { id: number }[]) {
      db.prepare("INSERT INTO payment_allocations (payment_id,order_id,amount_toman,created_at) VALUES (?,?,10000,?)").run(pid, o.id, iso(5));
    }
    const h = customerHealthFor(1, steady);
    expect(h.band).toBe("good");
  });

  it("a lapsed customer with 30+ day debt is risk, naming cadence and payment", () => {
    // one delivery 90 days ago, unpaid; a prior one 110 days ago so mean interval ~20
    order(lapsed, iso(110), "DELIVERED", 10, 1000, 900, iso(110));
    order(lapsed, iso(90), "DELIVERED", 10, 1000, 900, iso(90));
    // a credit limit the unpaid deliveries have blown through
    getDb().prepare("UPDATE customers SET credit_limit_toman = 15000 WHERE id = ?").run(lapsed);
    const h = customerHealthFor(1, lapsed);
    expect(h.band).toBe("risk");
    expect(h.reasons).toContain("سفارش‌ها از ریتم همیشگی عقب افتاده");
    expect(h.reasons).toContain("بدهی معوق نزدیک سقف اعتبار");
  });

  it("customersHealthOverview for a manager is limited to their group", () => {
    order(steady, iso(10), "DELIVERED", 1, 1000, 800, iso(10));
    const rows = customersHealthOverview(session("group_manager", eastMgr, gEast));
    const ids = rows.map((r) => r.customer_id);
    expect(ids).toContain(steady);
    expect(ids).toContain(lapsed);
    expect(ids).not.toContain(westCust);
  });

  it("materialiseHealth writes a customer-scoped health_score snapshot", () => {
    order(steady, iso(10), "DELIVERED", 1, 1000, 800, iso(10));
    const written = materialiseHealth(1, PERIOD);
    expect(written).toBeGreaterThan(0);
    const v = snapshot(1, "health_score", { scope_type: "customer", scope_id: steady, period: PERIOD });
    expect(v).not.toBeNull();
    expect(v as number).toBeGreaterThanOrEqual(0);
    expect(v as number).toBeLessThanOrEqual(100);
  });
});
