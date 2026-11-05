import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-task-push-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { runSweepRules } = await import("@/lib/repo/rules");
const { setTaskPushMinutes } = await import("@/lib/repo/taskPush");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("push before a timed task (S19)", () => {
  it("pings the assignee once, only for a task with a time inside the lead minutes", async () => {
    const db = getDb();
    const now = "2026-11-05T09:00:00.000Z";
    const user = Number((await db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at, organization_id) VALUES ('s','x','م','phone_sales',?,1)").run(now)).lastInsertRowid);
    const task = (title: string, due: string) => db.prepare("INSERT INTO tasks (organization_id, assignee_user_id, kind, title, due_at, priority, status, created_at) VALUES (1, ?, 'call', ?, ?, 'NORMAL', 'open', ?)").run(user, title, due, now);
    await task("تماس با رضا", "2026-11-05T09:08:00.000Z");
    await task("دیرتر", "2026-11-05T09:30:00.000Z");
    await task("فقط روز", "2026-11-05");

    await runSweepRules(1, now);
    await runSweepRules(1, "2026-11-05T09:03:00.000Z");
    const rows = (await db.prepare("SELECT user_id, body_fa FROM notifications WHERE type_code = 'task.due_soon'").all()) as { user_id: number; body_fa: string }[];
    expect(rows).toEqual([{ user_id: user, body_fa: "تماس با رضا" }]);

    await setTaskPushMinutes(1, 45);
    await runSweepRules(1, "2026-11-05T09:04:00.000Z");
    expect(((await db.prepare("SELECT body_fa FROM notifications WHERE type_code = 'task.due_soon' ORDER BY id").all()) as { body_fa: string }[]).map((r) => r.body_fa)).toEqual(["تماس با رضا", "دیرتر"]);
  });
});
