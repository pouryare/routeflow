import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-overdue-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { queueOverdueLessonNudges } = await import("@/lib/repo/academyOverdue");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("overdue lesson push", () => {
  it("tells each person with a late required lesson once, and not the ones who finished or are not late", async () => {
    const db = getDb();
    const tag = Math.random().toString(36).slice(2, 7);
    const mk = async (name: string, joined: string) => Number((await db.prepare("INSERT INTO users (username,password_hash,display_name,role,active,created_at,organization_id) VALUES (?,'x',?,'phone_sales',1,?,1)").run(`${name}-${tag}`, name, joined)).lastInsertRowid);
    const late = await mk("late", "2026-01-01T00:00:00.000Z");
    const done = await mk("done", "2026-01-01T00:00:00.000Z");
    const fresh = await mk("fresh", new Date().toISOString());
    const lesson = Number((await db.prepare(
      `INSERT INTO academy_lessons (organization_id, title, body, roles, required, due_days, status, created_at, updated_at)
       VALUES (1, 'قوانین تخفیف', 'x', 'phone_sales', true, 7, 'published', '2026-01-01', '2026-01-01')`
    ).run()).lastInsertRowid);
    await db.prepare("INSERT INTO lesson_progress (organization_id, user_id, lesson_slug, completed_at, version_read) VALUES (1, ?, ?, '2026-01-02', 1)").run(done, `c-${lesson}`);

    const who = async () => ((await db.prepare("SELECT user_id FROM notifications WHERE type_code = 'academy.lesson_overdue' AND group_key LIKE ?").all(`%:${lesson}:%`)) as { user_id: number }[]).map((r) => Number(r.user_id));
    expect(await queueOverdueLessonNudges(1)).toBeGreaterThanOrEqual(1);
    const first = await who();
    expect(first).toContain(late);
    expect(first).not.toContain(done);
    expect(first).not.toContain(fresh);
    // the second sweep does not tell them again
    await queueOverdueLessonNudges(1);
    expect((await who()).filter((id) => id === late)).toHaveLength(1);
  });
});
