import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-kpisnap-repo-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { computeMetric, refreshSnapshots, snapshot, kpiBoard } = await import("@/lib/repo/kpiSnapshots");
const { refreshAll } = await import("@/lib/repo/analysisRefresh");
const { periodOf, shiftPeriod, periodRange } = await import("@/lib/analysis/period");
import type { Session } from "@/lib/session";
import type { Role, UserRow } from "@/lib/db";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const IN_MONTH = "2026-03-10";
const PERIOD = periodOf(`${IN_MONTH}T00:00:00.000Z`);
const PREV = shiftPeriod(PERIOD, 1);
const { toExcl } = periodRange(PERIOD);
const before = (days: number) => new Date(Date.parse(toExcl) - days * 86_400_000).toISOString().slice(0, 10);

function session(role: Role, uid: number, gid: number | null): Session {
  return { user: { id: uid, role, group_id: gid, organization_id: 1 } as UserRow, role, groupId: gid, organizationId: 1 };
}

let owner = 0;
let grp = 0;
let cX = 0;
let cY = 0;
let product = 0;
let pkg = 0;

beforeEach(() => {
  const db = getDb();
  db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM kpi_snapshots; DELETE FROM targets; DELETE FROM payments; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; DELETE FROM groups; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  grp = Number(db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('گ','g',?,1)").run(now).lastInsertRowid);
  owner = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o','x','م','owner',?,1)").run(now).lastInsertRowid);
  cX = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('X','ایکس','active',?,?,1)").run(now, grp).lastInsertRowid);
  cY = Number(db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('Y','ایگرگ','active',?,?,1)").run(now, grp).lastInsertRowid);
  product = Number(db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','K',0.25,?,?,1)").run(now, now).lastInsertRowid);
  pkg = Number(db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(product, now).lastInsertRowid);
});

function order(customerId: number, orderDate: string, packs: number, price: number, cost: number, status = "DELIVERED") {
  const db = getDb();
  const now = new Date().toISOString();
  const oid = Number(
    db.prepare(
      "INSERT INTO orders (order_no,customer_id,group_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o'||abs(random()),?,?,?,?,?,?,?,1)"
    ).run(customerId, grp, status, orderDate, owner, now, now).lastInsertRowid
  );
  db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,?,?,?,?,1,0.25,?)"
  ).run(oid, product, pkg, packs, packs, price, cost, now);
  return oid;
}

describe("kpi snapshots repo", () => {
  it("refreshSnapshots writes rows and net_sales matches the hand sum", () => {
    order(cX, IN_MONTH, 10, 1000, 700); // 10_000
    order(cY, IN_MONTH, 4, 1000, 700); // 4_000
    const { written } = refreshSnapshots(1, PERIOD);
    expect(written).toBeGreaterThan(0);
    expect(snapshot(1, "net_sales", { scope_type: "org", period: PERIOD })).toBe(14_000);
  });

  it("computeMetric gross_margin is a ratio with parts", () => {
    order(cX, IN_MONTH, 10, 1000, 750);
    const r = computeMetric(1, "gross_margin", { scope_type: "org", scope_id: 0 }, PERIOD);
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThanOrEqual(1);
    expect(r.numerator).toBe(2500);
    expect(r.denominator).toBe(10_000);
  });

  it("active_customers respects the 60-day window ending at period-end", () => {
    order(cX, IN_MONTH, 1, 1000, 700); // inside the window
    order(cY, before(70), 1, 1000, 700); // 70 days before period-end → out
    const r = computeMetric(1, "active_customers", { scope_type: "org", scope_id: 0 }, PERIOD);
    expect(r.value).toBe(1);
  });

  it("re-running a period does not duplicate rows", () => {
    order(cX, IN_MONTH, 10, 1000, 700);
    refreshSnapshots(1, PERIOD);
    refreshSnapshots(1, PERIOD);
    const n = (getDb().prepare("SELECT COUNT(*) n FROM kpi_snapshots WHERE metric='net_sales' AND scope_type='org' AND period=?").get(PERIOD) as { n: number }).n;
    expect(n).toBe(1);
  });

  it("kpiBoard reads snapshots only — survives deleting every order", () => {
    order(cX, IN_MONTH, 10, 1000, 700);
    // prior month
    const prevDate = periodRange(PREV).from;
    order(cX, prevDate, 6, 1000, 700);
    refreshSnapshots(1, PERIOD);
    refreshSnapshots(1, PREV);

    const before = kpiBoard(1, PERIOD, PREV, session("owner", owner, null));
    getDb().exec("DELETE FROM order_lines; DELETE FROM orders;");
    const after = kpiBoard(1, PERIOD, PREV, session("owner", owner, null));

    expect(after).toEqual(before);
    const ns = before.find((c) => c.metric === "net_sales")!;
    expect(ns.value).toBe(10_000);
    expect(ns.prev_value).toBe(6_000);
    expect(before).toHaveLength(14);
  });

  it("kpiBoard marks on_track against a target when one exists", () => {
    order(cX, IN_MONTH, 10, 1000, 700); // net_sales 10_000
    refreshSnapshots(1, PERIOD);
    getDb()
      .prepare("INSERT INTO targets (organization_id,user_id,group_id,period,metric,target_value,created_at) VALUES (1,NULL,NULL,?,'revenue_toman',8000,?)")
      .run(PERIOD, new Date().toISOString());
    const board = kpiBoard(1, PERIOD, PREV, session("owner", owner, null));
    const ns = board.find((c) => c.metric === "net_sales")!;
    expect(ns.target).toBe(8000);
    expect(ns.on_track).toBe(true);
  });

  it("refreshAll runs clean and stamps both periods", () => {
    order(cX, IN_MONTH, 10, 1000, 700);
    const res = refreshAll(1, `${IN_MONTH}T12:00:00.000Z`);
    expect(res.period).toBe(PERIOD);
    expect(res.prev_period).toBe(PREV);
    expect(res.written).toBeGreaterThan(0);
    expect(snapshot(1, "net_sales", { scope_type: "org", period: PERIOD })).toBe(10_000);
  });
});
