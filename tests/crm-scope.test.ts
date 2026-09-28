import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-scope-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { crmFilter, canSeeBusiness, canWriteBusiness } = await import("@/lib/session");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-01T00:00:00.000Z";
const db = getDb();
db.prepare("INSERT INTO organizations (id, name, slug, created_at) VALUES (2, 'دیگر', 'other', ?)").run(NOW);
const g1 = Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','g1',?,1)").run(NOW).lastInsertRowid);
const g2 = Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g2','g2',?,1)").run(NOW).lastInsertRowid);
const user = (u: string, role: string, gid: number | null, org = 1) =>
  Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,?)").run(u, "x", u, role, gid, NOW, org).lastInsertRowid);
const repA = user("repA", "phone_sales", g1);
const repB = user("repB", "phone_sales", g1);
const mgr1 = user("mgr1", "group_manager", g1);
const cust = (code: string, owner: number | null, gid: number | null, org = 1) =>
  Number(db.prepare("INSERT INTO customers (customer_code,business_name,owner_user_id,group_id,synced_at,organization_id) VALUES (?,?,?,?,?,?)").run(code, code, owner, gid, NOW, org).lastInsertRowid);
const mineA = cust("A1", repA, g1);
const mineB = cust("B1", repB, g1);
const pool1 = cust("P1", null, g1);
const pool2 = cust("P2", null, g2);
const other = cust("O1", null, null, 2);

const sess = (id: number, role: Session["role"], groupId: number | null, organizationId = 1): Session =>
  ({ user: { id } as Session["user"], role, groupId, organizationId });
const visible = (s: Session) => {
  const f = crmFilter(s, "c");
  return (db.prepare(`SELECT id FROM customers c WHERE 1 = 1${f.sql} ORDER BY id`).all(...f.params) as { id: number }[]).map((r) => r.id);
};

describe("crmFilter", () => {
  it("salesperson: own + own group's unassigned pool", () => {
    expect(visible(sess(repA, "phone_sales", g1))).toEqual([mineA, pool1]);
  });
  it("group manager and rep manager: their group", () => {
    expect(visible(sess(mgr1, "group_manager", g1))).toEqual([mineA, mineB, pool1]);
    expect(visible(sess(mgr1, "rep_manager", g1))).toEqual([mineA, mineB, pool1]);
    expect(visible(sess(mgr1, "group_manager", null))).toEqual([]);
  });
  it("owner: the whole organisation, never another", () => {
    expect(visible(sess(1, "owner", null))).toEqual([mineA, mineB, pool1, pool2]);
    expect(visible(sess(1, "owner", null, 2))).toEqual([other]);
  });
  it("driver: nothing", () => expect(visible(sess(99, "delivery_driver", g1))).toEqual([]));
});

describe("canSeeBusiness / canWriteBusiness", () => {
  const row = (owner_user_id: number | null, group_id: number | null, organization_id = 1) => ({ owner_user_id, group_id, organization_id });
  it("mirrors the filter", () => {
    expect(canSeeBusiness(sess(repA, "phone_sales", g1), row(repB, g1))).toBe(false);
    expect(canSeeBusiness(sess(repA, "phone_sales", g1), row(null, g1))).toBe(true);
    expect(canSeeBusiness(sess(1, "owner", null), row(null, null, 2))).toBe(false);
  });
  it("lets a salesperson write their own and claim the pool; a manager writes the group", () => {
    expect(canWriteBusiness(sess(repA, "phone_sales", g1), row(repA, g1))).toBe(true);
    expect(canWriteBusiness(sess(repA, "phone_sales", g1), row(null, g1))).toBe(true);
    expect(canWriteBusiness(sess(repA, "phone_sales", g1), row(repB, g1))).toBe(false);
    expect(canWriteBusiness(sess(mgr1, "group_manager", g1), row(repB, g1))).toBe(true);
    expect(canWriteBusiness(sess(mgr1, "group_manager", g1), row(repB, g2))).toBe(false);
  });
});
