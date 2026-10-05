import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Point at a *copy* of production to prove the Phase 2 loud-channel migration (three new
 *  tables, seven ADD COLUMNs, the `default_push` / `default_telegram` backfill, and the
 *  five new catalogue rows + notify rules) applies cleanly to a real backup without
 *  touching a single pre-existing row:
 *
 *    NOTIF_P2_MIGRATION_CHECK_DB=/tmp/copy.db npx vitest run tests/notifications-phase2-migration-realdata
 *
 *  Without the env var it copies the newest backup it can find and skips if there is none
 *  -- CI has no backup, same as every sibling *-realdata test. Phase 1's version looks only
 *  in data/backups/; this one also checks backups/, which is where this deployment actually
 *  writes them, so the check runs locally instead of skipping forever. */
const provided = process.env.NOTIF_P2_MIGRATION_CHECK_DB;
let dbPath = provided ?? "";
let temp = false;
if (!provided) {
  for (const dir of [path.join(process.cwd(), "data", "backups"), path.join(process.cwd(), "backups")]) {
    if (dbPath) break;
    try {
      const newest = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".db"))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0]?.f;
      if (newest) {
        dbPath = path.join(os.tmpdir(), `rf-notif-p2-realcheck-${Date.now()}.db`);
        // WAL-aware: routeflow.db runs in WAL mode, so copying the .db alone yields a
        // silently stale snapshot. The -wal/-shm sidecars must come with it.
        for (const s of ["", "-wal", "-shm"]) {
          const src = path.join(dir, `${newest}${s}`);
          if (fs.existsSync(src)) fs.copyFileSync(src, `${dbPath}${s}`);
        }
        temp = true;
      }
    } catch {
      /* directory absent -- try the next one */
    }
  }
}

// Row counts on the untouched copy, BEFORE getDb() migrates it. An old backup may lack a
// table entirely -- only snapshot (and later re-check) what actually exists.
const before: Record<string, number> = {};
if (dbPath) {
  const raw = new DatabaseSync(dbPath);
  for (const t of ["users", "customers", "reminders", "cheques", "push_subscriptions"]) {
    const exists = raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(t);
    if (exists) before[t] = (raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  }
  raw.close();
}

process.env.ROUTEFLOW_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-notif-p2-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb, seedNotificationTypes, loudByDefault, NOTIFICATION_TYPE_SEED } = await import("@/lib/db");
const { ensureWarehouse } = await import("./helpers/ensureWarehouse");
ensureWarehouse(getDb());

function columns(db: ReturnType<typeof getDb>, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe.skipIf(!dbPath)("Phase 2 loud-channel migration on real data", () => {
  it("adds the tables, columns, seeds and backfill, touching nothing else", () => {
    const db = getDb(); // runs every migration, Phase 1's included, plus both seeds

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    // Task 1: the three new tables exist (table_info returns one row per column).
    for (const t of ["notification_prefs", "notification_channels", "notification_deliveries"]) {
      expect(columns(db, t).length, t).toBeGreaterThan(0);
    }

    // Task 1: the seven guarded ADD COLUMNs landed.
    expect(columns(db, "notification_types")).toEqual(
      expect.arrayContaining(["default_push", "default_telegram"])
    );
    expect(columns(db, "push_subscriptions")).toContain("user_id");
    expect(columns(db, "users")).toEqual(expect.arrayContaining(["telegram_chat_id", "telegram_link_nonce"]));
    expect(columns(db, "notifications")).toEqual(expect.arrayContaining(["push_flushed_at", "tg_flushed_at"]));

    // Phase 1's 7 catalogue rows + Phase 2's 5 + system.test = 13; >= so a later phase
    // adding a row does not retroactively fail this migration test.
    const cat = db
      .prepare("SELECT COUNT(*) AS c FROM notification_types WHERE organization_id IS NULL")
      .get() as { c: number };
    expect(cat.c).toBeGreaterThanOrEqual(13);

    // Phase 1's 8 notify rules + Phase 2's 5 = 13.
    const rules = db
      .prepare("SELECT COUNT(*) AS c FROM rules WHERE action_kind = 'notify' AND organization_id IS NULL")
      .get() as { c: number };
    expect(rules.c).toBeGreaterThanOrEqual(13);

    // Every pre-existing push subscription survives, and none is falsely attributed: the
    // ADD COLUMN gives them NULL, and only a fresh POST /api/push/subscribe stamps an owner.
    const orphaned = db
      .prepare("SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id IS NOT NULL")
      .get() as { c: number };
    expect(orphaned.c).toBe(0);

    // Nothing pre-existing was added, dropped, or rewritten.
    for (const [t, n] of Object.entries(before)) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n, t).toBe(n);
    }
  });

  it("backfills a Phase-1 catalogue row that predates the loud-by-default columns", () => {
    const db = getDb();

    // A database migrated by Phase 1 has its 7 catalogue rows already; Phase 2's
    // `ALTER TABLE ... DEFAULT 0` would leave every one of them silently quiet. That is
    // exactly the state reproduced here -- the INSERT ... WHERE NOT EXISTS in
    // seedNotificationTypes cannot fix it, only the backfill UPDATE can.
    db.prepare(
      "UPDATE notification_types SET default_push = 0, default_telegram = 0 WHERE organization_id IS NULL"
    ).run();

    seedNotificationTypes(db);

    for (const t of NOTIFICATION_TYPE_SEED) {
      const loud = loudByDefault(t.directedness, t.priority);
      const row = db
        .prepare(
          "SELECT default_push, default_telegram FROM notification_types WHERE organization_id IS NULL AND code = ?"
        )
        .get(t.code) as { default_push: number; default_telegram: number };
      expect(row, t.code).toEqual({ default_push: loud, default_telegram: loud });
    }

    // The two that matter most: a directed HIGH type must come back loud, and system.test
    // must be loud too or the «ارسال پیام آزمایشی» button can never send (Ruling P2-F).
    const assigned = db
      .prepare("SELECT default_push FROM notification_types WHERE organization_id IS NULL AND code = 'task.assigned'")
      .get() as { default_push: number };
    expect(assigned.default_push).toBe(1);
    const test = db
      .prepare(
        "SELECT default_push, default_telegram FROM notification_types WHERE organization_id IS NULL AND code = 'system.test'"
      )
      .get() as { default_push: number; default_telegram: number };
    expect(test).toEqual({ default_push: 1, default_telegram: 1 });
  });

  it("leaves a tenant's own catalogue override alone", () => {
    const db = getDb();
    const org = db.prepare("SELECT id FROM organizations ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (!org) return; // a backup with no tenants has nothing to protect

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO notification_types
         (organization_id, code, name_fa, category, directedness, priority, group_scope,
          default_push, default_telegram, active, created_at, updated_at)
       VALUES (?, 'task.assigned', 'x', 'task', 'directed', 'HIGH', 'entity', 0, 0, 1, ?, ?)`
    ).run(org.id, now, now);

    seedNotificationTypes(db);

    // The backfill is scoped `WHERE organization_id IS NULL`; a tenant that deliberately
    // silenced a type must stay silenced across every reboot.
    const row = db
      .prepare(
        "SELECT default_push, default_telegram FROM notification_types WHERE organization_id = ? AND code = 'task.assigned'"
      )
      .get(org.id) as { default_push: number; default_telegram: number };
    expect(row).toEqual({ default_push: 0, default_telegram: 0 });

    db.prepare("DELETE FROM notification_types WHERE organization_id = ? AND code = 'task.assigned'").run(org.id);
    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
