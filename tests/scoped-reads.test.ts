import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-scoped-reads-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());
const { listPaymentsScoped, recordPayment, customerGroupOf } = await import("@/lib/repo/payments");
const { listTasks, createTask } = await import("@/lib/repo/tasks");
const { listAlerts } = await import("@/lib/repo/alerts");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let g1 = 0, g2 = 0, sellerA = 0, sellerB = 0, custA = 0, custB = 0;

beforeAll(() => {
  const db = getDb();
  const now = new Date().toISOString();
  g1 = Number(db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('A','a',?,1)").run(now).lastInsertRowid);
  g2 = Number(db.prepare("INSERT INTO groups (name,slug,created_at,organization_id) VALUES ('B','b',?,1)").run(now).lastInsertRowid);
  const u = db.prepare("INSERT INTO users (username,password_hash,display_name,role,group_id,active,created_at,organization_id) VALUES (?,?,?,?,?,1,?,1)");
  sellerA = Number(u.run("sa", "x", "الف", "phone_sales", g1, now).lastInsertRowid);
  sellerB = Number(u.run("sb", "x", "ب", "phone_sales", g2, now).lastInsertRowid);
  const c = db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,group_id,organization_id) VALUES (?,?,'active',?,?,1)");
  custA = Number(c.run("CA", "الف", now, g1).lastInsertRowid);
  custB = Number(c.run("CB", "ب", now, g2).lastInsertRowid);
  recordPayment(1, { customer_id: custA, amount_toman: 1000, method: "CASH", received_at: now, received_by: sellerA } as never);
  recordPayment(1, { customer_id: custB, amount_toman: 2000, method: "CASH", received_at: now, received_by: sellerB } as never);
});

describe("payments are scoped", () => {
  it("a group sees only its own customers' receipts", () => {
    expect(listPaymentsScoped(1, { groupIds: [g1] }).map((p) => p.customer_id)).toEqual([custA]);
    expect(listPaymentsScoped(1, { groupIds: [] })).toEqual([]);
  });
  it("a salesperson sees what they took, not a colleague's", () => {
    expect(listPaymentsScoped(1, { salespersonId: sellerA }).map((p) => p.customer_id)).toEqual([custA]);
    expect(listPaymentsScoped(1, { salespersonId: sellerB }).map((p) => p.customer_id)).toEqual([custB]);
  });
  it("reports a customer's group", () => {
    expect(customerGroupOf(1, custB)).toEqual({ group_id: g2 });
    expect(customerGroupOf(1, 999999)).toBeUndefined();
  });
});

describe("tasks and alerts are scoped by group", () => {
  it("tasks: group tasks stay in the group, ungrouped ones are company-wide", () => {
    createTask(1, { title: "الف", kind: "call", group_id: g1, created_by: sellerA } as never);
    createTask(1, { title: "ب", kind: "call", group_id: g2, created_by: sellerB } as never);
    createTask(1, { title: "همه", kind: "call", group_id: null, created_by: sellerA } as never);
    const titles = (ids: number[]) => listTasks(1, { groupIds: ids }).map((t) => t.title).sort();
    expect(titles([g1])).toEqual(["الف", "همه"].sort());
    expect(titles([])).toEqual(["همه"]);
    expect(listTasks(1, {}).length).toBe(3);
  });
  it("alerts: same rule", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const cols = (db.prepare("PRAGMA table_info(alerts)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("group_id");
    const ins = db.prepare("INSERT INTO alerts (organization_id, category, severity, title, group_id, created_at) VALUES (1, 'stock', 'warning', ?, ?, ?)");
    ins.run("الف", g1, now); ins.run("ب", g2, now); ins.run("همه", null, now);
    expect(listAlerts(1, { groupIds: [g2] }).map((a) => a.title).sort()).toEqual(["ب", "همه"].sort());
    expect(listAlerts(1, {}).length).toBe(3);
  });
});
