import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rf-foldin-")), "t.db");
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, foldLeadPinsIntoCustomers } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

let nextRun = 500;
let nextPin = 910;
let nextDay = 1;

/* Seeds a pin that is BOTH in a lead list and on a lead run, and the run holding the
   stop. This is the shape that makes the fold dangerous.
   Ids AND the run_date increment per call: lead_runs carries
   UNIQUE(driver_user_id, run_date) — "two lead runs for one driver on one day is the bug
   that constraint exists to stop" (lib/repo/leadRuns.ts) — so a fixed date collides
   across two calls. Each test gets its own run, and neither depends on the other's rows. */
function seedPinOnRun() {
  const db = getDb();
  const runId = nextRun++;
  const pinId = nextPin++;
  const runDate = `2026-01-${String(nextDay++).padStart(2, "0")}`;
  /* lead_runs.driver_user_id REFERENCES users(id), so the driver has to exist. The first
     test in this file already creates org 3 and a group, so those are present. */
  db.exec(`INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, active, created_at, organization_id)
           VALUES (1, 'd1', 'راننده', 'x', 'delivery_driver', 1, '2026-01-01', 3)`);
  db.exec(`INSERT INTO lead_runs (id, driver_user_id, run_date, status, planned_by, organization_id, created_at, updated_at)
           VALUES (${runId}, 1, '${runDate}', 'planned', 1, 3, '${runDate}', '${runDate}')`);
  db.exec(`INSERT INTO saved_locations (id, name, maps_url, resolution, group_id, created_at, updated_at, organization_id)
           VALUES (${pinId}, 'پین روی مسیر', 'https://maps.example/z-${pinId}', 'manual', 30, '2026-01-01', '2026-01-01', 3)`);
  db.exec(`INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (40, ${pinId}, 0, '2026-01-01')`);
  /* lead_run_stops has NO organization_id (lib/db.ts:1332-1339) -- it is reached through
     lead_runs. Note line 1335: `location_id ... REFERENCES saved_locations(id) ON
     DELETE CASCADE`. That clause is the entire hazard this test guards. */
  db.exec(`INSERT INTO lead_run_stops (run_id, location_id, sort_order, created_at)
           VALUES (${runId}, ${pinId}, 0, '2026-01-01')`);
  return { db, runId, pinId };
}

describe("lead-pin fold-in", () => {
  it("converts pinned leads to customers and clears the pins", () => {
    const db = getDb();
    db.exec(`INSERT INTO organizations (id,name,slug,created_at) VALUES (3,'T','t','2026-01-01')`);
    db.exec(`INSERT INTO groups (id,name,slug,created_at,organization_id) VALUES (30,'G','g','2026-01-01',3)`);
    // A pin in a lead list...
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, address, lat, lng, resolution, notes, group_id, created_at, updated_at, organization_id)
             VALUES (900, 'رستوران تست', 'https://maps.example/x', 'جایی', 35.7, 51.4, 'manual', 'یادداشت', 30, '2026-01-01','2026-01-01', 3)`);
    db.exec(`INSERT INTO lead_lists (id, name, created_at, updated_at) VALUES (40, 'L', '2026-01-01','2026-01-01')`);
    db.exec(`INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (40, 900, 0, '2026-01-01')`);
    // ...and a pin NOT in any list (left alone)
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, resolution, group_id, created_at, updated_at, organization_id)
             VALUES (901, 'رها', 'https://maps.example/y', 'manual', 30, '2026-01-01','2026-01-01', 3)`);

    foldLeadPinsIntoCustomers(db);

    const cust = db
      .prepare(
        "SELECT customer_code, lifecycle, organization_id, group_id, business_name, notes FROM customers WHERE customer_code='LEAD-900'"
      )
      .get() as
      | { customer_code: string; lifecycle: string; organization_id: number; group_id: number; business_name: string; notes: string }
      | undefined;
    expect(cust).toMatchObject({
      lifecycle: "lead",
      organization_id: 3,
      group_id: 30,
      business_name: "رستوران تست",
      notes: "یادداشت",
    });
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=900").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM lead_list_items WHERE location_id=900").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=901").get()).toBeTruthy(); // untouched

    // idempotent
    expect(() => foldLeadPinsIntoCustomers(db)).not.toThrow();
    expect(
      db.prepare("SELECT COUNT(*) n FROM customers WHERE customer_code='LEAD-900'").get()
    ).toMatchObject({ n: 1 });
  });

  it("skips a pin that has a run stop, and the stop SURVIVES", () => {
    /* The assertion that matters is the second one.
     *
     * lead_run_stops.location_id is `REFERENCES saved_locations(id) ON DELETE CASCADE`,
     * and the fold issues a hand-written `DELETE FROM saved_locations WHERE id = ?`. So
     * promoting a pin on a live run deletes the pin, the cascade takes the stop with it,
     * and the database considers the whole thing correct. A driver's assigned work — a
     * promise the office made this morning — would be gone, silently.
     *
     * Asserting only that the pin was SKIPPED would pass even if the delete still
     * happened, because the two are the same statement. So the stop is read afterwards. */
    const { db, pinId } = seedPinOnRun();

    const result = foldLeadPinsIntoCustomers(db);

    expect(
      db.prepare(`SELECT 1 FROM customers WHERE customer_code='LEAD-${pinId}'`).get(),
    ).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=?").get(pinId)).toBeTruthy();

    // And, the part that actually matters: the stop is still there.
    expect(
      db.prepare("SELECT 1 FROM lead_run_stops WHERE location_id=?").get(pinId),
      "the fold must never cascade a run stop",
    ).toBeTruthy();

    // And the behaviour is visible rather than silent — the spec's §5.1.
    expect(result.skipped).toContain(pinId);
  });

  it("promotes the pin once its run is done", () => {
    /* The migration is eventually consistent with the runs, not destructive to them: the
     * pin waits for the run to finish, and a later boot picks it up. Re-running is safe,
     * which is what makes that true. */
    const { db, runId, pinId } = seedPinOnRun();
    foldLeadPinsIntoCustomers(db);
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=?").get(pinId)).toBeTruthy();

    // The driver finishes the day.
    db.exec(`UPDATE lead_runs SET status='done' WHERE id=${runId}`);

    foldLeadPinsIntoCustomers(db);

    expect(
      db
        .prepare("SELECT customer_code, lifecycle FROM customers WHERE customer_code=?")
        .get(`LEAD-${pinId}`),
    ).toMatchObject({ customer_code: `LEAD-${pinId}`, lifecycle: "lead" });
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=?").get(pinId)).toBeUndefined();
  });

  it("skips a pin an import row still points at, and does not abort the fold", () => {
    /* The fourth referrer, and the one that actually breaks the page.
     *
     * `lead_import_items.saved_location_id INTEGER REFERENCES saved_locations(id)`
     * (lib/db.ts:1069) — NO `ON DELETE CASCADE`, and the column is nullable. So
     * `PRAGMA foreign_key_check` reports nothing for it, a read of the schema's CASCADE
     * clauses alone would miss it, and the spec's §1.1 inventory did not list it.
     *
     * Found by booting the REAL dev database, which is the only thing that could have
     * found it: the fold raised FOREIGN KEY constraint failed, rolled the whole
     * transaction back, and /leads could not open at all. 45 pins qualified; the first
     * one it touched had a pasted import row hanging off it.
     *
     * A guard that only consults CASCADE referrers is a guard that passes while the
     * database is unusable. The question is "does ANY row point at this pin". */
    const db = getDb();
    db.exec(`INSERT OR IGNORE INTO lead_import_jobs (id, organization_id, status, created_at)
             VALUES (700, 3, 'done', '2026-01-01')`);
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, resolution, group_id, created_at, updated_at, organization_id)
             VALUES (940, 'پین وارداتی', 'https://maps.example/imp-940', 'manual', 30, '2026-01-01', '2026-01-01', 3)`);
    db.exec(`INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (40, 940, 2, '2026-01-01')`);
    db.exec(`INSERT INTO lead_import_items (id, organization_id, job_id, ordinal, name, maps_url, resolution, status, saved_location_id)
             VALUES (710, 3, 700, 0, 'x', 'https://maps.example/imp-940', 'manual', 'done', 940)`);

    // Must not throw. Before the fix this aborted the entire transaction.
    const result = foldLeadPinsIntoCustomers(db);

    expect(
      db.prepare("SELECT 1 FROM customers WHERE customer_code='LEAD-940'").get(),
    ).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM saved_locations WHERE id=940").get()).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM lead_import_items WHERE saved_location_id=940").get())
      .toBeTruthy();
    expect(result.skipped).toContain(940);
  });

  it("still runs when the one-shot marker is set", () => {
    /* The regression this task exists to prevent.
     *
     * The boot call site guarded the fold on `app_meta.lead_pin_foldin_done`, which makes
     * a data-dependent migration time-dependent: a pin added to a lead list today would
     * never be promoted, on any future boot, however long it waited. The marker is written
     * once and the guard then hides the fold forever.
     *
     * This asserts the FUNCTION's behaviour; the next test is what checks the call site,
     * because that is where the guard actually was. */
    const db = getDb();
    db.exec(`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('lead_pin_foldin_done', '2020-01-01T00:00:00Z')`);

    // A pin that entered the business AFTER the marker was written.
    db.exec(`INSERT INTO saved_locations (id, name, maps_url, resolution, group_id, created_at, updated_at, organization_id)
             VALUES (930, 'پین تازه', 'https://maps.example/new-930', 'manual', 30, '2026-02-01', '2026-02-01', 3)`);
    db.exec(`INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (40, 930, 1, '2026-02-01')`);

    foldLeadPinsIntoCustomers(db);

    /* Promoted. With the old one-shot guard, nothing would have touched it — which is the
       whole defect: a row that qualifies, silently not promoted, forever. */
    expect(
      db.prepare("SELECT lifecycle FROM customers WHERE customer_code='LEAD-930'").get(),
    ).toMatchObject({ lifecycle: "lead" });
  });

  it("the boot call site does not gate the fold on a marker", () => {
    /* The test above passes whether or not the boot call site is guarded, so this is the
     * assertion that actually holds the fix. A one-shot guard there would make every
     * qualifying row that arrives later permanently unpromoted — and no test anywhere
     * would notice, because the function itself is fine.
     *
     * Comments are stripped, and deliberately: the fix's own comment has to name the
     * marker key to explain the bug, and a test that forbids a string must not forbid
     * the sentence explaining why it was removed. */
    const src = fs.readFileSync("lib/db.ts", "utf8");
    const from = src.indexOf("export function getDb");
    const raw = src.slice(from, src.indexOf("backfillLegacyPayments", from));
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(code, "the boot call must be unconditional").not.toMatch(/lead_pin_foldin_done/);
  });
});
