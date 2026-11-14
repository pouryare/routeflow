import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-wrap-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { wrapUpFor, closeDay, wrapUpEmpty } = await import("@/lib/repo/wrapUp");

afterAll(() => { for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true }); });

let rep = 0, other = 0, cust = 0;
beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  rep = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('w-rep','x:y','م','phone_sales',1,?,1)").run(now)).lastInsertRowid);
  other = Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES ('w-oth','x:y','م','phone_sales',1,?,1)").run(now)).lastInsertRowid);
  cust = Number((await db.prepare("INSERT INTO customers (customer_code,business_name,customer_type,lifecycle,synced_at,organization_id) VALUES ('W1','x','RESTAURANT','active','2026-01-01',1)").run()).lastInsertRowid);
  const t = (who: number, due: string, title: string) =>
    db.prepare("INSERT INTO tasks (organization_id, kind, title, assignee_user_id, due_at, status, created_at) VALUES (1, 'call', ?, ?, ?, 'open', ?)").run(title, who, due, now);
  await t(rep, "2026-11-12T08:00:00Z", "دیروز");
  await t(rep, "2026-11-14T08:00:00Z", "فردا");
  await t(other, "2026-11-12T08:00:00Z", "دیگری");
});

describe("rep daily wrap-up", () => {
  it("lists only my overdue tasks and tomorrow's first calls, and closing twice is fine", async () => {
    const w = await wrapUpFor(1, rep, "2026-11-13");
    expect(w.overdueTasks.map((t) => t.title)).toEqual(["دیروز"]);
    expect(w.tomorrow.map((t) => t.title)).toEqual(["فردا"]);
    expect(w.closed).toBe(false);
    expect(wrapUpEmpty(w)).toBe(false);
    await closeDay(1, rep, "2026-11-13");
    await closeDay(1, rep, "2026-11-13");
    expect((await wrapUpFor(1, rep, "2026-11-13")).closed).toBe(true);
    expect((await wrapUpFor(1, other, "2026-11-13")).closed).toBe(false);
    expect(cust).toBeGreaterThan(0);
  });
});
