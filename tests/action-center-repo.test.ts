import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-actioncenter-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { actionCenterFor } = await import("@/lib/repo/actionCenter");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

function session(role: Role, uid: number, gid: number | null): Session {
  return { user: { id: uid, role, group_id: gid, organization_id: 1 } as UserRow, role, groupId: gid, organizationId: 1 };
}

let owner = 0;
let driver = 0;
let grp = 0;
let cust = 0;
let product = 0;
let pkg = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM kpi_snapshots; DELETE FROM churn_scores; DELETE FROM alerts; DELETE FROM order_events; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM payments; DELETE FROM payment_allocations; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; DELETE FROM groups; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  grp = Number(db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('گ','g',?,1)").run(now).lastInsertRowid);
  owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)").run(now).lastInsertRowid);
  driver = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('d','x','ر','driver',?,?,1)").run(grp, now).lastInsertRowid);
  cust = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('C','مشتری','active',?,?,1)").run(now, grp).lastInsertRowid);
  product = Number(db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','K',0.25,?,?,1)").run(now, now).lastInsertRowid);
  pkg = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(product, now).lastInsertRowid);
});

function order(status: string, orderDate: string, packs: number, price: number, deliveredAt?: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const oid = Number(
    db.prepare(
      "INSERT INTO orders (order_no,customer_id,group_id,status,order_date,delivered_at,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,?,?,?,?,?,?,?,1)"
    ).run(cust, grp, status, orderDate.slice(0, 10), deliveredAt ?? null, owner, now, now).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,?,?,?,700,1,0.25,?)"
  ).run(oid, product, pkg, packs, packs, price, now);
  return oid;
}

describe("action center repo", () => {
  it("surfaces an open critical alert", () => {
    getDb()
      .prepare("INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'critical','stock','بچ رو به انقضا',?)")
      .run(iso(1));
    const r = actionCenterFor(session("owner", owner, null));
    expect(r.critical.some((c) => c.kind === "alert")).toBe(true);
  });

  it("flags a CONFIRMED order stalled four days as a warning", () => {
    const oid = order("CONFIRMED", iso(6), 5, 1000);
    getDb()
      .prepare("INSERT INTO order_events (organization_id,order_id,from_status,to_status,action,actor_user_id,created_at) VALUES (1,?,NULL,'CONFIRMED','x',?,?)")
      .run(oid, owner, iso(4));
    const r = actionCenterFor(session("owner", owner, null));
    const hit = r.warning.find((c) => c.key === `stalled_order:${oid}`);
    expect(hit).toBeTruthy();
    expect(hit!.kind).toBe("stalled_order");
  });

  it("a big 30+ day unpaid receivable is critical", () => {
    order("DELIVERED", iso(45), 100, 250_000, iso(45)); // 25m toman, unpaid
    const r = actionCenterFor(session("owner", owner, null));
    expect(r.critical.some((c) => c.kind === "overdue_receivable")).toBe(true);
  });

  it("a driver gets nothing", () => {
    getDb()
      .prepare("INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'critical','stock','x',?)")
      .run(iso(1));
    const r = actionCenterFor(session("driver", driver, grp));
    expect(r).toEqual({ critical: [], warning: [], opportunity: [] });
  });

  it("surfaces a high churn_scores row as a warning", () => {
    getDb()
      .prepare(
        "INSERT INTO churn_scores (organization_id,customer_id,probability,band,reason_fa,computed_at) VALUES (1,?,0.82,'high','مدت‌هاست از ریتم خرید عقب افتاده',?)"
      )
      .run(cust, iso(1));
    const r = actionCenterFor(session("owner", owner, null));
    expect(r.warning.some((c) => c.key === `churn:${cust}`)).toBe(true);
  });

  it("respects the per-bucket cap", () => {
    for (let i = 0; i < 20; i++) {
      getDb()
        .prepare("INSERT INTO alerts (organization_id,severity,category,title,created_at) VALUES (1,'warning','other',?,?)")
        .run(`هشدار ${i}`, iso(i + 1));
    }
    const r = actionCenterFor(session("owner", owner, null));
    expect(r.warning.length).toBeLessThanOrEqual(12);
  });
});
