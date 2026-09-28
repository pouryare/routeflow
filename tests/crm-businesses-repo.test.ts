import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-biz-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { listBusinesses, viewCounts, getBusiness, flowContextFor, addLeadContext } = await import("@/lib/repo/crm/businesses");
const { findDuplicates } = await import("@/lib/repo/crm/dedupe");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

const NOW = "2026-09-11T06:00:00.000Z"; // 09:30 Tehran
const db = getDb();
const g1 = Number(db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('g1','g1',?,1)").run(NOW).lastInsertRowid);
const user = (u: string, role: string) =>
  Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,created_at,organization_id) VALUES (?,?,?,?,?,?,1)").run(u, "x", u, role, g1, NOW).lastInsertRowid);
const repA = user("repA", "phone_sales");
const repB = user("repB", "phone_sales");
const mgr = user("mgr", "group_manager");
const cust = (name: string, owner: number | null, extra: Record<string, unknown> = {}) => {
  const row = { customer_code: name, business_name: name, owner_user_id: owner, group_id: g1, synced_at: NOW, organization_id: 1,
    verification: "unverified", sales_stage: "unknown", contact_status: "not_contacted", temperature: "cold", ...extra };
  const k = Object.keys(row);
  return Number(db.prepare(`INSERT INTO customers (${k.join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...(Object.values(row) as never[])).lastInsertRowid);
};
const hotLead = cust("کبابی داغ", repA, { temperature: "hot", phone: "09120001234", phone_norm: "9120001234", lat: 35.76, lng: 51.41 });
const custA = cust("مشتری الف", repA, { sales_stage: "customer", verification: "verified" });
const pool = cust("سرنخ بی‌صاحب", null);
const bLead = cust("کافه لمیز تجریش", repB, { phone_norm: "9120005678", lat: 35.8, lng: 51.43 });
const task = Number(db.prepare("INSERT INTO tasks (organization_id, kind, title, entity_type, entity_id, due_at, assignee_user_id, created_at) VALUES (1,'call','تماس اول','customer',?,?,?,?)").run(hotLead, "2026-09-11T10:00:00.000Z", repA, NOW).lastInsertRowid);
db.prepare("UPDATE customers SET next_task_id = ? WHERE id = ?").run(task, hotLead);
db.prepare("INSERT INTO contacts (organization_id, customer_id, name, role, is_primary, created_at, updated_at) VALUES (1,?,?,?,1,?,?)").run(hotLead, "علی", "PURCHASING", NOW, NOW);

const sess = (id: number, role: Session["role"]): Session => ({ user: { id } as Session["user"], role, groupId: g1, organizationId: 1, roles: [role], hasRole: (x) => x === role });
const A = sess(repA, "phone_sales");
const ids = (r: { rows: { id: number }[] }) => r.rows.map((x) => x.id).sort((a, b) => a - b);

describe("listBusinesses", () => {
  it("today: open next actions due by the end of today (Tehran)", () => {
    const r = listBusinesses(A, { view: "today", nowIso: NOW });
    expect(ids(r)).toEqual([hotLead]);
    expect(r.rows[0]).toMatchObject({ next_title: "تماس اول", contact_name: "علی", contact_role: "PURCHASING" });
  });
  it("views split leads, customers and the pool", () => {
    expect(ids(listBusinesses(A, { view: "my_leads", nowIso: NOW }))).toEqual([hotLead]);
    expect(ids(listBusinesses(A, { view: "my_customers", nowIso: NOW }))).toEqual([custA]);
    expect(ids(listBusinesses(A, { view: "unassigned", nowIso: NOW }))).toEqual([pool]);
    expect(ids(listBusinesses(A, { view: "hot", nowIso: NOW }))).toEqual([hotLead]);
    expect(ids(listBusinesses(A, { view: "all", nowIso: NOW }))).toEqual([hotLead, custA, pool]);
    expect(ids(listBusinesses(sess(mgr, "group_manager"), { view: "all", nowIso: NOW }))).toEqual([hotLead, custA, pool, bLead]);
  });
  it("searches name and phone", () => {
    expect(ids(listBusinesses(A, { view: "all", q: "داغ", nowIso: NOW }))).toEqual([hotLead]);
    expect(ids(listBusinesses(A, { view: "all", q: "۰۰۰۱۲", nowIso: NOW }))).toEqual([hotLead]);
  });
  it("counts every view", () => {
    expect(viewCounts(A, NOW)).toMatchObject({ today: 1, my_leads: 1, my_customers: 1, unassigned: 1, hot: 1, all: 3 });
  });
  it("paginates in a stable order and stops at the last page", () => {
    const first = listBusinesses(A, { view: "all", limit: 2, nowIso: NOW });
    expect(first.rows.map((r) => r.id)).toEqual([hotLead, custA]);
    expect(first.nextOffset).toBe(2);
    const last = listBusinesses(A, { view: "all", limit: 2, offset: first.nextOffset!, nowIso: NOW });
    expect(last.rows.map((r) => r.id)).toEqual([pool]);
    expect(last.nextOffset).toBeNull();
  });
  it("returns an empty final page for a search with no matches", () => {
    expect(listBusinesses(A, { view: "all", q: "no-matching-business", nowIso: NOW }))
      .toEqual({ rows: [], nextOffset: null });
  });
});

describe("getBusiness / contexts", () => {
  it("returns null out of scope", () => {
    expect(getBusiness(A, bLead)).toBeNull();
    expect(getBusiness(A, hotLead)?.business_name).toBe("کبابی داغ");
  });
  it("builds the after-call context", () => {
    const r = flowContextFor(A, hotLead, "call")!;
    expect(r.ctx).toMatchObject({ entry: "call", firstContact: true, attemptNo: 1, isManager: false });
    expect(r.ctx.knownContacts).toEqual([{ id: expect.any(Number), name: "علی", role: "PURCHASING" }]);
    expect(r.ctx.vars.name).toBe("کبابی داغ");
  });
  it("builds the add-lead context with reps for a manager only", () => {
    expect(addLeadContext(A).reps).toEqual([]);
    const m = addLeadContext(sess(mgr, "group_manager"));
    expect(m.isManager).toBe(true);
    expect(m.reps.map((r) => r.id).sort()).toEqual([repA, repB].sort());
  });
});

describe("findDuplicates", () => {
  it("normalizes Instagram queries and scopes and redacts matching businesses", () => {
    db.prepare("UPDATE customers SET instagram = ? WHERE id = ?").run("kababi.hot", hotLead);
    db.prepare("UPDATE customers SET instagram = ? WHERE id = ?").run("cafe.lamiz", bLead);
    try {
      expect(findDuplicates(A, { instagram: "https://www.instagram.com/Kababi.Hot/?hl=fa" })).toEqual([
        expect.objectContaining({ kind: "instagram", reachable: true, id: hotLead, name: "کبابی داغ" }),
      ]);
      expect(findDuplicates(A, { instagram: "@Cafe.Lamiz" })).toEqual([
        expect.objectContaining({ kind: "instagram", reachable: false, id: null, name: null }),
      ]);
      expect(findDuplicates({ ...A, organizationId: 999 }, { instagram: "kababi.hot" })).toEqual([]);
      expect(findDuplicates(A, { phone: "09120001234", instagram: "kababi.hot" })).toHaveLength(1);
    } finally {
      db.prepare("UPDATE customers SET instagram = NULL WHERE id IN (?, ?)").run(hotLead, bLead);
    }
  });
  it("shows a reachable phone match in full and redacts one the caller cannot see", () => {
    expect(findDuplicates(A, { phone: "0912 000 1234" })).toEqual([
      expect.objectContaining({ kind: "phone", reachable: true, id: hotLead, name: "کبابی داغ" }),
    ]);
    expect(findDuplicates(A, { phone: "09120005678" })).toEqual([
      expect.objectContaining({ kind: "phone", reachable: false, id: null, name: null, owner_name: "repB" }),
    ]);
  });
  it("warns about a similar name close by, not far away", () => {
    const near = findDuplicates(sess(mgr, "group_manager"), { name: "کافه لمیز", lat: 35.8005, lng: 51.4302 });
    expect(near).toEqual([expect.objectContaining({ kind: "name", id: bLead })]);
    expect(findDuplicates(sess(mgr, "group_manager"), { name: "کافه لمیز", lat: 35.7, lng: 51.3 })).toEqual([]);
  });
});
