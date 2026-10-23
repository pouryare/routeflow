import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-crm-brief-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { todayFor } = await import("@/lib/repo/briefing");
type Session = import("@/lib/session").Session;

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

describe("briefing → after-call flow", () => {
  it("carries the customer on a salesperson's customer task", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const rep = Number(db.prepare("INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES ('br','x','br','phone_sales',?,1)").run(now).lastInsertRowid);
    const c = Number(db.prepare("INSERT INTO customers (customer_code,business_name,synced_at,organization_id) VALUES ('BR-1','ب',?,1)").run(now).lastInsertRowid);
    db.prepare("INSERT INTO tasks (organization_id, assignee_user_id, kind, title, entity_type, entity_id, due_at, created_at) VALUES (1,?,'call','تماس اول','customer',?,?,?)").run(rep, c, now, now);
    db.prepare("INSERT INTO tasks (organization_id, assignee_user_id, kind, title, created_at) VALUES (1,?,'note','یادداشت',?)").run(rep, now);
    const s: Session = { user: { id: rep } as Session["user"], role: "phone_sales", groupId: null, organizationId: 1, roles: ["phone_sales"], hasRole: (x) => x === "phone_sales" };
    const items = todayFor(s).panels.find((p) => p.key === "open_tasks")!.items;
    expect(items.find((i) => i.label === "تماس اول")!.action).toEqual({ kind: "task_outcome", task_id: expect.any(Number), customer_id: c, snoozable: true });
    expect(items.find((i) => i.label === "یادداشت")!.action).toEqual({ kind: "task_outcome", task_id: expect.any(Number), snoozable: true });
  });
});
