import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-task-access-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { canActOnTask, assigneeInOrg } = await import("@/lib/repo/tasks");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let userOrg1 = 0, userOrg2 = 0, inactive = 0;
beforeAll(async () => {
  const db = getDb();
  await db.exec("INSERT INTO organizations (id,name,slug,created_at) VALUES (2,'Two','two','2026-01-01')");
  const now = new Date().toISOString();
  const ins = db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,?,?,?,?,?,?)");
  userOrg1 = Number((await ins.run("a", "x", "ا", "phone_sales", 1, now, 1)).lastInsertRowid);
  userOrg2 = Number((await ins.run("b", "x", "ب", "phone_sales", 1, now, 2)).lastInsertRowid);
  inactive = Number((await ins.run("c", "x", "ج", "phone_sales", 0, now, 1)).lastInsertRowid);
});

const row = (o: Partial<{ assignee_user_id: number | null; group_id: number | null; role_hint: string | null }> = {}) =>
  ({ assignee_user_id: null, group_id: null, role_hint: null, ...o });

describe("who may act on a task", () => {
  it("owners, the platform key and the rep manager act on anything", () => {
    for (const role of ["owner", "platform_owner", "rep_manager"]) {
      expect(canActOnTask({ role, userId: 1, groupId: null }, row({ assignee_user_id: 99, group_id: 7 }))).toBe(true);
    }
  });
  it("a group manager is held to their group and company-wide tasks", () => {
    const gm = { role: "group_manager", userId: 1, groupId: 3 };
    expect(canActOnTask(gm, row({ group_id: 3 }))).toBe(true);
    expect(canActOnTask(gm, row({ group_id: null }))).toBe(true);
    expect(canActOnTask(gm, row({ group_id: 4 }))).toBe(false);
  });
  it("everyone else acts on their own tasks, or unassigned ones for their role", () => {
    const rep = { role: "phone_sales", userId: 5, groupId: 3 };
    expect(canActOnTask(rep, row({ assignee_user_id: 5 }))).toBe(true);
    expect(canActOnTask(rep, row({ assignee_user_id: 6 }))).toBe(false);
    expect(canActOnTask(rep, row({ assignee_user_id: null, role_hint: "phone_sales" }))).toBe(true);
    expect(canActOnTask(rep, row({ assignee_user_id: null, role_hint: "delivery_driver" }))).toBe(false);
    expect(canActOnTask({ role: "delivery_driver", userId: 7, groupId: null }, row({ assignee_user_id: 5 }))).toBe(false);
  });
});

describe("assignee must belong to the organisation", () => {
  it("accepts an active colleague and refuses a stranger, an inactive user and junk", async () => {
    expect(await assigneeInOrg(1, userOrg1)).toBe(true);
    expect(await assigneeInOrg(1, userOrg2)).toBe(false);
    expect(await assigneeInOrg(1, inactive)).toBe(false);
    expect(await assigneeInOrg(1, 99999)).toBe(false);
    expect(await assigneeInOrg(1, 1.5)).toBe(false);
  });
});

describe("a task's linked record must be real and in the organisation", () => {
  it("accepts no link, a real customer/order of the org, and refuses the rest", async () => {
    const { taskEntityValid } = await import("@/lib/repo/tasks");
    const db = getDb();
    const now = new Date().toISOString();
    const c1 = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('T1','x','active',?,1)").run(now)).lastInsertRowid);
    const c2 = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,lifecycle,synced_at,organization_id) VALUES ('T2','y','active',?,2)").run(now)).lastInsertRowid);
    expect(await taskEntityValid(1, null, null)).toBe(true);
    expect(await taskEntityValid(1, undefined, undefined)).toBe(true);
    expect(await taskEntityValid(1, "customer", c1)).toBe(true);
    expect(await taskEntityValid(1, "customer", c2)).toBe(false); // another tenant
    expect(await taskEntityValid(1, "customer", 999999)).toBe(false);
    expect(await taskEntityValid(1, "district", c1)).toBe(false); // not a linkable type
    expect(await taskEntityValid(1, "customer", null)).toBe(false); // half a link
    expect(await taskEntityValid(1, null, c1)).toBe(false);
    expect(await taskEntityValid(1, "customer; DROP TABLE x", c1)).toBe(false);
  });
});
