import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-repo-rules-recurring-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { createRecurrence } = await import("@/lib/repo/taskRecurrences");
const { spawnRecurringTasks, runSweepRules } = await import("@/lib/repo/rules");
const { gregorianToJalali } = await import("@/lib/jalali");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let user = 0;
beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM task_recurrences; DELETE FROM tasks; DELETE FROM users WHERE id > 0;");
  user = Number(
    db
      .prepare(
        "INSERT INTO users (username,password_hash,display_name,role,created_at,organization_id) VALUES (?,?,?,?,?,1)"
      )
      .run(`rec${Date.now()}`, "x", "م", "group_manager", new Date().toISOString()).lastInsertRowid
  );
});

function countTasks(title: string): number {
  return (getDb().prepare("SELECT COUNT(*) n FROM tasks WHERE title = ?").get(title) as { n: number }).n;
}

describe("spawnRecurringTasks", () => {
  it("spawns a daily recurrence once per day and dedupes on re-run", () => {
    const now = new Date().toISOString();
    createRecurrence(
      1,
      { title: "چک روزانهٔ انبار", kind: "admin", role_hint: "group_manager", rrule: "daily", priority: "NORMAL" },
      user
    );

    const first = spawnRecurringTasks(1, now);
    expect(first.spawned).toBe(1);
    expect(countTasks("چک روزانهٔ انبار")).toBe(1);

    const second = spawnRecurringTasks(1, now);
    expect(second.spawned).toBe(0);
    expect(countTasks("چک روزانهٔ انبار")).toBe(1);

    // a task dated today, from the recurrence's template fields
    const t = getDb()
      .prepare("SELECT kind, role_hint, priority, due_at FROM tasks WHERE title = ?")
      .get("چک روزانهٔ انبار") as { kind: string; role_hint: string; priority: string; due_at: string };
    expect(t).toMatchObject({ kind: "admin", role_hint: "group_manager", priority: "NORMAL" });
    expect(t.due_at).toBe(now.slice(0, 10));
  });

  it("respects the weekday of a weekly rrule", () => {
    // Pick tomorrow's weekday so today does NOT match. spawnRecurringTasks resolves
    // "today" against the Tehran civil date (see lib/jalali), so the expected weekday
    // has to come from that same clock -- deriving it from getUTCDay() is off by a day
    // for the ~3.5h each evening when UTC and Tehran sit on different dates.
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const tehranDay = (d: Date) =>
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", weekday: "short" })
        .format(d)
        .toLowerCase()
        .slice(0, 3);
    const tomorrowDay = tehranDay(tomorrow);
    createRecurrence(
      1,
      { title: "کار هفتگی فردا", kind: "outreach", role_hint: "salesperson", rrule: `weekly:${tomorrowDay}`, priority: "LOW" },
      user
    );
    expect(spawnRecurringTasks(1, today.toISOString()).spawned).toBe(0);
    expect(countTasks("کار هفتگی فردا")).toBe(0);
  });

  it("is invoked by runSweepRules", () => {
    createRecurrence(
      1,
      { title: "از مسیر جاروب", kind: "admin", role_hint: "group_manager", rrule: "daily", priority: "LOW" },
      user
    );
    runSweepRules(1, new Date().toISOString());
    expect(countTasks("از مسیر جاروب")).toBe(1);
    void gregorianToJalali; // silence unused in some runs
  });
});
