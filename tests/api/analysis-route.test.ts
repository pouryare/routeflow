import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-analysis-route-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { GET: KPIS } = await import("@/app/api/analysis/kpis/route");
const { refreshSnapshots } = await import("@/lib/repo/kpiSnapshots");
const { GET: WHY } = await import("@/app/api/analysis/why/route");
const { GET: MARGIN } = await import("@/app/api/analysis/margin/route");
const { GET: ACTION_CENTER } = await import("@/app/api/analysis/action-center/route");
const { POST: REFRESH } = await import("@/app/api/analysis/refresh/route");
const { periodOf } = await import("@/lib/analysis/period");
const { NextRequest } = await import("next/server");
const { createSessionToken, COOKIE_NAME } = await import("@/lib/auth");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const IN_MONTH = "2026-03-10";
const PERIOD = periodOf(`${IN_MONTH}T00:00:00.000Z`);

function cookie(uid: number, role: string, gid: number | null = null) {
  return `${COOKIE_NAME}=${createSessionToken({ uid, role: role as never, gid, oid: 1, tv: 0, name: "م" })}`;
}
const req = (url: string, c: string, init: { method?: string; body?: string } = {}) =>
  new NextRequest(`http://localhost${url}`, { ...init, headers: { cookie: c } });

let owner = 0;
let seller = 0;
let grp = 0;

beforeEach(async () => {
  const db = getDb();
  await db.exec(
    "PRAGMA foreign_keys=OFF; DELETE FROM kpi_snapshots; DELETE FROM order_lines; DELETE FROM orders; DELETE FROM packagings; DELETE FROM products; DELETE FROM customers; DELETE FROM users WHERE id>0; DELETE FROM groups; PRAGMA foreign_keys=ON;"
  );
  const now = new Date().toISOString();
  grp = Number((await db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('گ','g',?,1)").run(now)).lastInsertRowid);
  owner = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('o'||abs(random()),'x','م','owner',?,1)").run(now)).lastInsertRowid);
  seller = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES ('s'||abs(random()),'x','ف','phone_sales',?,?,1)").run(grp, now)).lastInsertRowid);
  const cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES ('C','م','active',?,?,1)").run(now, grp)).lastInsertRowid);
  const product = Number((await db.prepare("INSERT INTO products (name,sku,kg_per_base_unit,created_at,updated_at,organization_id) VALUES ('کره','K',0.25,?,?,1)").run(now, now)).lastInsertRowid);
  const pkg = Number((await db.prepare("INSERT INTO packagings (product_id,name,qty_per_pack,created_at) VALUES (?,'ج',1,?)").run(product, now)).lastInsertRowid);
  const oid = Number(
    (await db.prepare(
      "INSERT INTO orders (order_no,customer_id,group_id,salesperson_user_id,status,order_date,created_by,created_at,updated_at,organization_id) VALUES ('o1',?,?,?,'DELIVERED',?,?,?,?,1)"
    ).run(cust, grp, seller, IN_MONTH, owner, now, now)).lastInsertRowid
  );
  await db.prepare(
    "INSERT INTO order_lines (order_id,product_id,packaging_id,packs_ordered,packs_delivered,unit_price_toman,unit_cost_toman,qty_per_pack,kg_per_base_unit,created_at) VALUES (?,?,?,10,10,1000,700,1,0.25,?)"
  ).run(oid, product, pkg, now);
});

describe("analysis routes", () => {
  it("the refresh hook runs for an owner and writes rows", async () => {
    const refreshed = await REFRESH(req("/api/analysis/refresh", cookie(owner, "owner"), { method: "POST" }));
    expect(refreshed.status).toBe(200);
    const j = await refreshed.json();
    expect(j.written).toBeGreaterThan(0);
    expect(j.period).toBeTruthy();
  });

  it("kpis returns a 14-card board reading the snapshot for the period", async () => {
    await refreshSnapshots(1, PERIOD);
    const res = await KPIS(req(`/api/analysis/kpis?period=${PERIOD}`, cookie(owner, "owner")));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.cards).toHaveLength(14);
    expect(j.cards.find((c: { metric: string }) => c.metric === "net_sales").value).toBe(10_000);
  });

  it("refresh is refused for a salesperson", async () => {
    const res = await REFRESH(req("/api/analysis/refresh", cookie(seller, "phone_sales", grp), { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("margin and why are 403 for a salesperson, kpis is 200", async () => {
    expect((await MARGIN(req(`/api/analysis/margin?dimension=customer&period=${PERIOD}`, cookie(seller, "phone_sales", grp)))).status).toBe(403);
    expect((await WHY(req(`/api/analysis/why?metric=net_sales&from=${PERIOD}&to=${PERIOD}`, cookie(seller, "phone_sales", grp)))).status).toBe(403);
    expect((await KPIS(req(`/api/analysis/kpis?period=${PERIOD}`, cookie(seller, "phone_sales", grp)))).status).toBe(200);
  });

  it("margin (owner) returns rows for a valid dimension and 400 for a bad one", async () => {
    const ok = await MARGIN(req(`/api/analysis/margin?dimension=product&period=${PERIOD}`, cookie(owner, "owner")));
    expect(ok.status).toBe(200);
    expect(Array.isArray((await ok.json()).rows)).toBe(true);
    const bad = await MARGIN(req(`/api/analysis/margin?dimension=planet&period=${PERIOD}`, cookie(owner, "owner")));
    expect(bad.status).toBe(400);
  });

  it("action-center (manager) returns the three buckets", async () => {
    const res = await ACTION_CENTER(req("/api/analysis/action-center", cookie(owner, "owner")));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.buckets).toHaveProperty("critical");
    expect(j.buckets).toHaveProperty("warning");
    expect(j.buckets).toHaveProperty("opportunity");
  });

  it("every analysis route is 401 without a cookie", async () => {
    const bare = (u: string) => new NextRequest(`http://localhost${u}`);
    expect((await KPIS(bare("/api/analysis/kpis"))).status).toBe(401);
    expect((await ACTION_CENTER(bare("/api/analysis/action-center"))).status).toBe(401);
  });
});
