import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Point at a *copy* of production to prove the Phase 1 notification-system migration
 *  (Task 1 `notification_types` + `notifications` tables, Task 5 widened
 *  `rules.action_kind` CHECK, Task 6 seeded `notify` rules) applies cleanly to a real
 *  backup without touching a single pre-existing row:
 *
 *    NOTIF_MIGRATION_CHECK_DB=/tmp/copy.db npx vitest run tests/notifications-migration-realdata
 *
 *  Without the env var it copies the newest data/backups/*.db (WAL sidecars too) and
 *  skips if there is none -- CI has no backup, same as every sibling *-realdata test. */
const provided = process.env.NOTIF_MIGRATION_CHECK_DB;
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
      dbPath = path.join(os.tmpdir(), `rf-notif-realcheck-${Date.now()}.db`);
      // WAL-aware: copy the -wal/-shm sidecars too, or the snapshot is stale.
      for (const s of ["", "-wal", "-shm"]) {
        const src = path.join(dir, `${newest}${s}`);
        if (fs.existsSync(src)) fs.copyFileSync(src, `${dbPath}${s}`);
      }
      temp = true;
    }
  } catch {
    /* no backups dir */
  }
}

// Row counts on the untouched copy, BEFORE getDb() migrates it. A very old backup may
// lack one of these tables entirely -- only snapshot (and later re-check) what exists.
const before: Record<string, number> = {};
if (dbPath) {
  const raw = new DatabaseSync(dbPath);
  for (const t of ["customers", "orders", "users"]) {
    const exists = raw
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
      .get(t);
    if (exists) {
      before[t] = (raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    }
  }
  raw.close();
}

process.env.COVERAGE_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-notif-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

describe.skipIf(!dbPath)("Phase 1 notification-system migration on real data", () => {
  it("adds the two tables + seeds the catalogue and notify rules, touching nothing else", () => {
    const db = getDb(); // runs every migration incl. the rules CHECK rebuild + both seeds

    // The migration must not corrupt referential integrity.
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // Task 1: both new tables exist (PRAGMA table_info returns one row per column).
    expect((db.prepare("PRAGMA table_info(notification_types)").all() as unknown[]).length).toBeGreaterThan(0);
    expect((db.prepare("PRAGMA table_info(notifications)").all() as unknown[]).length).toBeGreaterThan(0);

    // Task 1 seed: the NULL-org catalogue (7 rows today; >= so a Phase 2 addition
    // does not retroactively fail this migration test).
    const cat = db
      .prepare("SELECT COUNT(*) AS c FROM notification_types WHERE organization_id IS NULL")
      .get() as { c: number };
    expect(cat.c).toBeGreaterThanOrEqual(7);

    // Task 5 + 6: `notify` is a valid action_kind and the 8 NULL-org notify rules seeded.
    const rules = db
      .prepare("SELECT COUNT(*) AS c FROM rules WHERE action_kind = 'notify' AND organization_id IS NULL")
      .get() as { c: number };
    expect(rules.c).toBeGreaterThanOrEqual(8);

    // A pre-existing table is populated and completely untouched by the migration.
    expect((db.prepare("SELECT COUNT(*) AS c FROM customers").get() as { c: number }).c).toBeGreaterThan(0);
    for (const [t, n] of Object.entries(before)) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(n);
    }

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
