import { describe, it, expect, afterAll, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The fold must survive a database that is ALREADY folded but still carries the table.
 *
 *  Phase 2 folds `lead_runs` into `delivery_runs` and drops it. "Should I run?" is answered by
 *  reading `sqlite_master` for `lead_runs` (lib/db.ts:344); the rebuild then reads
 *  `lead_run_stops`'s CREATE a SECOND time, inside the transaction (lib/db.ts:451).
 *
 *  When those two reads disagree — the table is still there, but the stops already point at
 *  `delivery_runs` — the replace finds nothing, `newSql === schema.sql`, and the function threw
 *  on EVERY boot. `getDb()` runs migrations, so that throw took down every request: a 500 on
 *  every page of data/routeflow.demo.db, not a rare edge.
 *
 *  The shape is not hypothetical, and it is not dangerous. In that database both lead tables
 *  are EMPTY and no foreign key anywhere references `lead_runs`, so there is nothing to cascade
 *  and nothing to restore — the message's "Restore from backups/" would have meant discarding a
 *  working 7MB database to repair an empty one.
 *
 *  So the rule under test: an EMPTY leftover is finished work and gets dropped; a leftover with
 *  ROWS is genuinely stranded and must still fail loudly, because that is the case the original
 *  guard was written for and the one where silence would destroy a driver's day.
 */

const tmpFiles: string[] = [];

function tmpPath(tag: string): string {
  const p = path.join(os.tmpdir(), `rf-fold-idem-${tag}-${Date.now()}.db`);
  tmpFiles.push(p);
  return p;
}

/** lib/db.ts reads ROUTEFLOW_DB_PATH at module load (lib/db.ts:21) and memoises the handle
 *  (lib/db.ts:23), so aiming it at another file needs a fresh module instance. */
async function bootAt(p: string) {
  vi.resetModules();
  process.env.ROUTEFLOW_DB_PATH = p;
  process.env.SESSION_SECRET = "test-secret";
  return import("@/lib/db");
}

/** A complete, correctly folded database — the state a fresh deployment is meant to reach. */
async function foldedDb(tag: string): Promise<string> {
  const p = tmpPath(tag);
  const mod = await bootAt(p);
  await mod.getDb().close();
  return p;
}

function raw(p: string): DatabaseSync {
  return new DatabaseSync(p);
}

function tableNames(p: string): string[] {
  const d = raw(p);
  const names = (
    d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
  ).map((r) => r.name);
  d.close();
  return names;
}

/** The historical CREATE, verbatim, so the leftover is the shape the fold actually met. */
const LEAD_RUNS_SQL = `CREATE TABLE lead_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_user_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER REFERENCES groups(id),
      run_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'done')),
      started_at TEXT,
      finished_at TEXT,
      notes TEXT,
      planned_by INTEGER NOT NULL REFERENCES users(id),
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (driver_user_id, run_date)
    )`;

/** Put the fossil back: the table the fold retired, standing next to stops already re-pointed.
 *
 *  The two-step rename is not decoration — it is the bug, reproduced faithfully. Step 3 ends in
 *  `ALTER TABLE lead_run_stops_fold_new RENAME TO lead_run_stops`, and SQLite rewrites the
 *  stored CREATE quoting the new name: `CREATE TABLE "lead_run_stops"`. The fold's own rename
 *  regex is `/CREATE TABLE\s+lead_run_stops/i`, and the quote sits exactly where `\s+` expects
 *  the name. So a database the fold has ALREADY been through cannot be recognised by the fold
 *  on its next boot — it is not idempotent, and the second run throws where the first succeeded.
 *  `data/routeflow.demo.db` carries that quoted form, which is why it 500s on every request.
 */
function addLeftover(p: string): void {
  const d = raw(p);
  d.exec(LEAD_RUNS_SQL);
  d.exec("PRAGMA foreign_keys = OFF");
  d.exec("ALTER TABLE lead_run_stops RENAME TO lead_run_stops_tmp");
  d.exec("ALTER TABLE lead_run_stops_tmp RENAME TO lead_run_stops");
  d.close();
}

afterAll(() => {
  for (const f of tmpFiles) {
    for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(f + suffix, { force: true });
  }
});

describe("foldLeadRuns — a leftover lead_runs must not brick every boot", () => {
  it("boots when lead_runs is an empty leftover and the stops are already re-pointed", async () => {
    const p = await foldedDb("empty");
    addLeftover(p);

    const mod = await bootAt(p);
    let handle: DatabaseSync | undefined;
    await expect(
      (async () => {
        handle = await mod.rawSqlite();
      })(),
      "opening the database must not fail on an empty leftover — it runs on every request"
    ).resolves.toBeUndefined();
    handle?.close();
  });

  it("drops that leftover, so the boot after it is a no-op", async () => {
    const p = await foldedDb("dropped");
    addLeftover(p);

    const db = (await bootAt(p)).getDb();
    await db.close();
    expect(
      tableNames(p),
      "the empty leftover must be gone, or every future boot re-enters the fold",
    ).not.toContain("lead_runs");
  });

  it("finishes the job when a leftover still holds runs and stops pointing at them", async () => {
    /* The state that matters, and the one the old guard refused. The stops table already
     * points at delivery_runs, but these rows still carry lead_runs ids and those runs still
     * need moving. Proceeding is safe precisely BECAUSE the foreign key is already correct: the
     * copy remaps run_id through _lead_run_map, and the table keeps the key it already has.
     * Refusing here is what turned a half-done fold into a permanent outage. */
    const p = await foldedDb("stranded");
    const d = raw(p);
    d.exec("PRAGMA foreign_keys = OFF");
    d.exec(LEAD_RUNS_SQL);
    d.prepare(
      `INSERT INTO lead_runs (driver_user_id, group_id, run_date, status, planned_by,
                              organization_id, created_at, updated_at)
       VALUES (1, NULL, '2026-10-06', 'planned', 1, 1, '2026-10-06', '2026-10-06')`
    ).run();
    /* location_id is left dangling deliberately — foreign keys are off for this fixture, and
     * the fold's own assertion is about run_id, which is what this test is about. */
    d.prepare(
      `INSERT INTO lead_run_stops (run_id, location_id, sort_order, created_at)
       VALUES (1, 4242, 1, '2026-10-06'), (1, 4243, 2, '2026-10-06')`
    ).run();
    d.exec("ALTER TABLE lead_run_stops RENAME TO lead_run_stops_tmp");
    d.exec("ALTER TABLE lead_run_stops_tmp RENAME TO lead_run_stops");
    d.close();

    const mod = await bootAt(p);
    await mod.dbReady();
    const db = mod.getDb();

    expect(tableNames(p), "the folded table must be gone").not.toContain("lead_runs");
    const run = await db
      .prepare("SELECT id, kind FROM delivery_runs WHERE run_date = '2026-10-06'")
      .get() as { id: number; kind: string } | undefined;
    expect(run, "the stranded run must be carried across, not dropped").toBeDefined();
    expect(run!.kind).toBe("mixed");

    /* Both stops survive and BOTH now name the run that exists. This is the assertion the whole
     * file is for: a stop that kept its old id would point at an unrelated delivery run, which
     * reads as a driver arriving at the wrong shop. */
    const stops = await db.prepare("SELECT run_id FROM lead_run_stops ORDER BY sort_order").all() as {
      run_id: number;
    }[];
    expect(stops.map((s) => s.run_id)).toEqual([run!.id, run!.id]);
    /* Scoped to run_id rather than a blanket foreign_key_check: this fixture parks stops on
     * location_ids that do not exist (see above), so a whole-table check would report the
     * fixture's own doing. The guarantee under test is the one the fold makes — every stop
     * names a run that exists — which is exactly what an orphaned stop would violate. */
    const dangling = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM lead_run_stops s
          WHERE NOT EXISTS (SELECT 1 FROM delivery_runs r WHERE r.id = s.run_id)`
      )
      .get() as { n: number };
    expect(dangling.n).toBe(0);
    await db.close();
  });

  it("STILL refuses when run_id points at lead_runs and the rebuild cannot re-point it", async () => {
    /* The alarm is kept, not deleted — it is just aimed at the thing that is actually wrong.
     * `REFERENCES "lead_runs"(id)` is quoted, so the textual re-point finds nothing to replace
     * and the rebuild would carry the OLD foreign key into the new table; dropping lead_runs
     * afterwards would then cascade every stop away. Silence here is the disaster this file
     * exists to prevent, so it must still fail loudly. */
    const p = await foldedDb("alarm");
    const d = raw(p);
    d.exec("PRAGMA foreign_keys = OFF");
    d.exec(LEAD_RUNS_SQL);
    d.exec("DROP TABLE lead_run_stops");
    d.exec(`CREATE TABLE lead_run_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES "lead_runs"(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES saved_locations(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (run_id, location_id)
    )`);
    d.close();

    const mod = await bootAt(p);
    await expect(mod.dbReady()).rejects.toThrow(/lead_runs/);
    expect(tableNames(p), "a failed fold must leave lead_runs standing").toContain("lead_runs");
  });
});