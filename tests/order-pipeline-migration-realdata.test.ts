import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Point at a *copy* of production to prove the Phase 3 order-pipeline migration is
 *  lossless:
 *
 *    ROUTEFLOW_MIGRATION_CHECK_DB=/tmp/copy.db npx vitest run tests/order-pipeline-migration-realdata
 *
 *  Without the env var it copies the newest data/backups/*.db and skips if there is none. */
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
      dbPath = path.join(os.tmpdir(), `rf-orderpipe-realcheck-${Date.now()}.db`);
      fs.copyFileSync(path.join(dir, newest), dbPath);
      temp = true;
    }
  } catch {
    /* no backups dir */
  }
}

// Count orders on the untouched copy BEFORE getDb() migrates it.
let ordersBefore = 0;
if (dbPath) {
  const raw = new DatabaseSync(dbPath);
  ordersBefore = (raw.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n;
  raw.close();
}

process.env.COVERAGE_DB_PATH = dbPath || path.join(os.tmpdir(), `rf-orderpipe-empty-${Date.now()}.db`);
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");
const { ORDER_STATUSES } = await import("@/lib/orderStateMachine");

describe.skipIf(!dbPath)("Phase 3 order pipeline migration on real data", () => {
  it("is lossless: no FK breakage, every status valid, every order keeps a create event", () => {
    const db = getDb(); // runs every migration incl. rebuildOrdersStatusMachine + backfillOrderEvents

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const valid = new Set(ORDER_STATUSES);
    const bad = (
      db.prepare("SELECT DISTINCT status FROM orders").all() as { status: string }[]
    ).filter((r) => !valid.has(r.status as never));
    expect(bad, `unknown statuses: ${bad.map((b) => b.status).join(", ")}`).toEqual([]);

    const after = (db.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n;
    expect(after).toBe(ordersBefore);

    const orphan = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id)"
        )
        .get() as { n: number }
    ).n;
    expect(orphan).toBe(0);

    expect(
      (db.prepare("SELECT value FROM app_meta WHERE key='order_events_backfill_done'").get() as
        | { value: string }
        | undefined) ?? null
    ).not.toBeNull();

    // Reservation is forward-only; the migration confirms nothing.
    expect((db.prepare("SELECT COUNT(*) AS n FROM stock_reservations").get() as { n: number }).n).toBe(0);

    if (temp) for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
  });
});
