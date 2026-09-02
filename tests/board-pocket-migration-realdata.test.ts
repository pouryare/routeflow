import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const provided = process.env.ROUTEFLOW_MIGRATION_CHECK_DB;
let dbPath = provided ?? "";
let temp = false;
if (!provided) {
  const dir = path.join(process.cwd(), "data", "backups");
  try {
    const newest = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]?.f;
    if (newest) {
      dbPath = path.join(os.tmpdir(), `rf-board-pocket-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
      temp = true;
    }
  } catch {
    /* none */
  }
}

process.env.COVERAGE_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-bp-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb, backfillReminderTasks } = await import("@/lib/db");

describe.skipIf(!dbPath)("Board & Pocket migration on real data", () => {
  it("adds columns + table, folds customer reminders losslessly, touches nothing else", () => {
    const db = getDb();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // schema delta present
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='task_recurrences'").get()).toBeTruthy();
    expect(
      (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).some((c) => c.name === "stage")
    ).toBe(true);
    expect(
      (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).some((c) => c.name === "prefs_json")
    ).toBe(true);
    expect((db.prepare("SELECT COUNT(*) n FROM task_recurrences").get() as { n: number }).n).toBe(0);

    // no pre-existing row got a stage or a pref
    expect(
      (db.prepare("SELECT COUNT(*) n FROM tasks WHERE stage IS NOT NULL").get() as { n: number }).n
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) n FROM users WHERE prefs_json IS NOT NULL").get() as { n: number }).n
    ).toBe(0);

    // backfill: every customer reminder is now exactly one task; district reminders untouched
    const remCust = (
      db.prepare("SELECT COUNT(*) n FROM reminders WHERE entity_type='customer'").get() as { n: number }
    ).n;
    const folded = (
      db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='reminder' AND entity_type='customer'").get() as { n: number }
    ).n;
    expect(folded).toBe(remCust);
    expect(
      (db.prepare("SELECT value FROM app_meta WHERE key='board_pocket_reminders_folded'").get() as { value: string }).value
    ).toBe("1");

    // a resolved reminder maps to a done task, an open one to an open task
    const openRem = (
      db.prepare("SELECT COUNT(*) n FROM reminders WHERE entity_type='customer' AND resolved=0").get() as { n: number }
    ).n;
    const openTask = (
      db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='reminder' AND entity_type='customer' AND status='open'").get() as { n: number }
    ).n;
    expect(openTask).toBe(openRem);

    // re-running the fold is a no-op
    backfillReminderTasks(db);
    expect(
      (db.prepare("SELECT COUNT(*) n FROM tasks WHERE kind='reminder' AND entity_type='customer'").get() as { n: number }).n
    ).toBe(folded);

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
