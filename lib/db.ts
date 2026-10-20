import { refreshRetiredWording } from "./repo/retiredWording";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import type { Role } from "./roles";
import type { CustomerLifecycle, CustomerType } from "./types";
import { polygonCentroid } from "./simplify";
import type { DistrictGeometry } from "./simplify";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "./orderStateMachine";
import { createCrmTables, migrateCrm } from "./repo/crm/migrate";
/* ledger.ts imports getDb from THIS module. ESM resolves it because neither module calls
   the other at evaluation time -- getDb and postJournal are both functions, so the cycle
   is inert. A lazy require() would be the wrong fix and does not exist in ESM. */
import { postJournal } from "./repo/ledger";

// Re-exported so server modules that already import from db.ts keep one import site.
export type { FacilityKind, FacilityRow } from "./facilityTypes";
export { FACILITY_KINDS, FACILITY_ICONS, defaultIconFor } from "./facilityTypes";

const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(process.cwd(), "data", "routeflow.db");

let _db: DatabaseSync | null = null;

/** Rows from node:sqlite, made safe to hand to a client component.
 *
 *  `DatabaseSync.prepare().all()` returns objects with a **null prototype**. React
 *  refuses to serialise those across the server/client boundary -- "Only plain objects,
 *  and a few built-ins, can be passed to Client Components" -- and the page 500s at
 *  render time. Nothing in the types sees it: a null-prototype object satisfies every
 *  interface it structurally matches, so tsc, eslint and every unit test pass while the
 *  page is broken. It only shows up in a browser.
 *
 *  So any query result that crosses into a `"use client"` component goes through here
 *  first. Results that only ever render on the server do not need it.
 */
export function plain<T>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

/** Tables whose rows belong to exactly one tenant and are scoped by organization_id.
 *
 *  A table not on this list and not in the exemption set in
 *  tests/tenancy-schema.test.ts fails the build. That is deliberate: the failure mode
 *  this list prevents is a table added later with no tenant column, which is readable
 *  by every organisation and looks like nothing at all until a second tenant is on the
 *  system.
 *
 *  Child tables are absent on purpose -- order_lines reaches its tenant through orders,
 *  and a second copy of the answer is a second thing to keep in step. */
export const TENANT_TABLES = [
  "groups",
  "customers",
  /* districts is deliberately ABSENT: it is shared geography, not tenant data. Tehran's
     22 منطقه are the same for every organisation, and per-tenant copies of the same
     polygons can drift apart until منطقه 14 means two different places. It was in this
     list, which meant the sweeps below re-ALTERed an organization_id onto it and stamped
     it to 1 on every row, every boot. */
  "facilities",
  "saved_locations",
  "lead_import_jobs",
  "lead_import_items",
  "lead_lists",
  "products",
  "orders",
  "purchases",
  "delivery_runs",
  /* "lead_runs" is GONE — folded into delivery_runs by foldLeadRunsIntoDeliveryRuns. Its
     stops live on in `lead_run_stops`, which has no organization_id of its own and is reached
     through delivery_runs, so there is nothing here for the sweep below to stamp. Leaving the
     name in the list would ALTER a column onto a table that no longer exists. */
  "lead_visit_activities",
  /* A draft belongs to a PERSON first, so it carries organization_id AND user_id -- and is
     therefore a tenant table in its own right rather than reaching a tenant through a run.
     It is here because it genuinely needs stamping, not because every table reaches one. */
  "run_drafts",
  "commission_rates",
  "commission_tiers",
  "commission_payments",
  "driver_commission_rates",
  "driver_commission_payments",
  "manager_commission_overrides",
  "manager_commission_payments",
  "representative_profiles",
  "credit_approvals",
  "payments",
  "cheques",
  "batches",
  "stock_movements",
  "delivery_line_batches",
  "quality_complaints",
  "reason_codes",
  "deliveries",
  "stock_reservations",
  "sync_mutations",
  "deleted_rows",
  "vehicles",
  "route_templates",
  "capacity_factors",
  "events",
  "tasks",
  "alerts",
  "rules",
  "rule_runs",
  "targets",
  "objection_cards",
  "lesson_progress",
  "kpi_definitions",
  "kpi_snapshots",
  "seasonal_factors",
  "forecast_models",
  "forecasts",
  "churn_models",
  "churn_scores",
  "task_recurrences",
  "notification_types",
  "notifications",
  "contacts",
  "activities",
  "customer_tags",
  "fiscal_periods",
  "journals",
  "ledger_entries",
  "suppliers",
] as const satisfies readonly string[];

/** Rebuild a table so a globally-UNIQUE natural key becomes unique per tenant instead.
 *
 *  SQLite cannot ALTER a constraint, so the only route is the same one this file already
 *  uses for the salesperson and platform_owner role widenings: build the replacement,
 *  copy every row, drop, rename. Guarded on the *constraint text* rather than on a
 *  column, because the columns are unchanged here -- it is only the uniqueness that
 *  moves.
 *
 *  Foreign keys are suspended for the copy. With them on, DROP TABLE would either fail
 *  or cascade into whatever references this table, depending on the pragma, and neither
 *  is what a rename wants -- the schema those referents see is unchanged either way. */
function rebuildForTenantUnique(
  db: DatabaseSync,
  table: string,
  marker: string,
  createSql: string
): void {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  if (!schema || schema.sql.includes(marker)) return;

  const tableCols = (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[])
    .map((c) => `"${c.name}"`)
    .join(", ");

  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.exec(`
      DROP TABLE IF EXISTS ${table}_tn_new;
      ${createSql}
      INSERT INTO ${table}_tn_new (${tableCols}) SELECT ${tableCols} FROM ${table};
      DROP TABLE ${table};
      ALTER TABLE ${table}_tn_new RENAME TO ${table};
    `);
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

/** Rebuild `facilities` so a facility can be a VAN.
 *
 *  Phase 8. `facilities.kind` carries a CHECK, and SQLite cannot alter one — so the table has to
 *  be rebuilt to allow 'van'. Nothing else about it changes.
 *
 *  WHY THIS EXISTS RATHER THAN BEING FOLDED INTO rebuildForTenantUnique: that helper's guard is
 *  the presence of `UNIQUE (organization_id, slug)`, and production ALREADY has that constraint.
 *  So its migration is a no-op on a real database and its DDL — however correct — never runs.
 *  The CHECK on kind is therefore frozen at whatever it was when the tenant migration landed, and
 *  the only thing that can widen it is a rebuild guarded on something else. Hence the guard below
 *  is the kind list itself.
 *
 *  Two lessons are baked in here, both learned the hard way:
 *
 *  - The copy list is derived from PRAGMA table_info and INTERSECTED with the columns the new
 *    table declares, never hand-written. An earlier version listed columns by hand and omitted
 *    `organization_id`, silently blanking the tenant on every facility.
 *  - The new table declares `UNIQUE (organization_id, slug)`, so rebuildForTenantUnique's marker
 *    is satisfied afterwards and it cannot fire a second time. Without that, two rebuilds run in
 *    sequence and the second copies a table the first already replaced.
 *
 *  Row count is asserted on both sides. This is the only place getDb() can duplicate or drop a
 *  populated facilities table, and it did exactly that once: 2 facilities became 4, silently.
 */
function rebuildFacilitiesForVan(db: DatabaseSync): void {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'facilities'")
    .get() as { sql: string } | undefined;
  if (!schema || schema.sql.includes("'van'")) return;

  const before = (db.prepare("SELECT COUNT(*) c FROM facilities").get() as { c: number }).c;

  const declared = [
    "id", "slug", "kind", "name", "address", "lat", "lng", "maps_url", "notes",
    "is_default_origin", "owner_username", "organization_id", "group_id",
    "created_at", "updated_at",
  ];
  const present = new Set(
    (db.prepare("PRAGMA table_info(facilities)").all() as unknown as { name: string }[]).map((c) => c.name),
  );
  // Only columns the OLD table actually has AND the new one declares. A name in either list but
  // not the other is a parse error at best and a silent data loss at worst.
  const cols = declared.filter((c) => present.has(c)).map((c) => `"${c}"`).join(", ");

  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.exec(`
      DROP TABLE IF EXISTS facilities_van_new;
      CREATE TABLE facilities_van_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'factory', 'van', 'home',
                                   'office', 'shop', 'cold_storage', 'parking', 'other')),
        name TEXT NOT NULL,
        /* The icon is the person's choice, not the kind's. It used to be derived from the
           kind, which meant a kind could only ever look like one thing, and adding a kind
           retroactively changed what every existing place of that kind looked like. NULL
           until chosen; the UI falls back to the kind's first option. */
        icon_key TEXT,
        address TEXT,
        /* Nullable: a place can be named before anyone has put it on the map. That is a
         * real state, and NOT NULL forced two writers to invent a location -- see the
         * comment on facilities.lat below. */
        lat REAL,
        lng REAL,
        maps_url TEXT,
        notes TEXT,
        is_default_origin INTEGER NOT NULL DEFAULT 0,
        owner_username TEXT,
        group_id INTEGER REFERENCES groups(id),
        organization_id INTEGER REFERENCES organizations(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (organization_id, slug)
      );
      INSERT INTO facilities_van_new (${cols}) SELECT ${cols} FROM facilities;
      DROP TABLE facilities;
      ALTER TABLE facilities_van_new RENAME TO facilities;
      CREATE INDEX IF NOT EXISTS idx_facilities_kind ON facilities(kind);
    `);
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }

  const after = (db.prepare("SELECT COUNT(*) c FROM facilities").get() as { c: number }).c;
  if (after !== before) {
    throw new Error(
      `rebuildFacilitiesForVan changed the row count: ${before} before, ${after} after. ` +
        `Restore from backups/ before going further — every warehouse, and every movement of ` +
        `stock that names one, depends on this table.`
    );
  }
}

/** Rebuild `districts` back to shared reference data: no organization_id, plain natural key.
 *
 *  The mirror image of rebuildForTenantUnique, and it exists because that helper copies
 *  every column by name out of PRAGMA table_info. That is right for a table whose columns do
 *  not change -- which is all rebuildForTenantUnique is for -- but this one DROPS a column,
 *  so the generic copy list would name a column the replacement does not have. Hence an
 *  explicit list, and hence the row-count assertion below.
 *
 *  The count assertion is the point. This is the only place in getDb() that can drop a
 *  populated table, and it is the same shape of catastrophe as the pin fold deleting a run
 *  stop mid-run (a98ae50): a rebuild that quietly lost rows would leave districts
 *  half-populated with no error anywhere. So it counts before, counts after, and throws if
 *  they differ. Zero rows in, zero rows out is the expected case and must also pass.
 *
 *  Guarded on the constraint text, like its siblings, so a database already migrated is a
 *  no-op and a fresh one migrates once. */
function rebuildDistrictsShared(db: DatabaseSync): void {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'districts'")
    .get() as { sql: string } | undefined;
  if (!schema || schema.sql.includes("UNIQUE(name, level, parent_name)")) return;

  // Every column that survives, in the order the replacement declares them. If one of these
  // is left out of either list the copy silently loses it, so the two lists are written out
  // rather than derived.
  const KEEP = [
    "id", "name", "level", "parent_name", "boundary_geojson", "coverage_status",
    "notes", "is_custom", "updated_at", "assigned_to", "centroid_lat", "centroid_lng", "group_id",
  ];
  const cols = KEEP.map((c) => `"${c}"`).join(", ");

  const before = (db.prepare("SELECT COUNT(*) c FROM districts").get() as { c: number }).c;

  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.exec(`
      DROP TABLE IF EXISTS districts_tn_new;
      CREATE TABLE districts_tn_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        level TEXT NOT NULL CHECK (level IN ('mantaghe', 'mahalle')),
        parent_name TEXT,
        boundary_geojson TEXT NOT NULL,
        coverage_status TEXT NOT NULL DEFAULT 'unknown'
          CHECK (coverage_status IN ('visited', 'needs_coverage', 'not_allowed', 'unknown')),
        notes TEXT,
        is_custom INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        assigned_to TEXT,
        centroid_lat REAL,
        centroid_lng REAL,
        group_id INTEGER REFERENCES groups(id),
        UNIQUE(name, level, parent_name)
      );
      INSERT INTO districts_tn_new (${cols}) SELECT ${cols} FROM districts;
      DROP TABLE districts;
      ALTER TABLE districts_tn_new RENAME TO districts;
    `);
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }

  const after = (db.prepare("SELECT COUNT(*) c FROM districts").get() as { c: number }).c;
  if (after !== before) {
    throw new Error(
      `rebuildDistrictsShared lost rows: ${before} before, ${after} after. The table is now ` +
      `${after} rows and the copy list is wrong -- restore from backups/ before going further.`
    );
  }
}

/** Phase 2 (mixed-route planning): fold `lead_runs` into `delivery_runs`.
 *
 *  Two tables for one idea — a driver, a day, an ordered set of stops — each with its own
 *  `UNIQUE (driver_user_id, run_date)`. Two constraints that never spoke to each other, so one
 *  driver could hold a delivery run AND a lead run on the same date, and each page showed only
 *  its own half of that day.
 *
 *  THE ORDER IS THE WHOLE FUNCTION, and it is the reverse of what is comfortable:
 *
 *    1. `kind` first, because every folded row needs it set and the default would be wrong.
 *    2. move the runs, recording old→new so step 4 can be checked against it.
 *    3. rebuild `lead_run_stops` — RE-POINTING ITS FOREIGN KEY, which SQLite cannot ALTER.
 *    4. drop `lead_runs`, and only once step 3 has proved every stop moved.
 *
 *  Step 3 is not optional. `lead_run_stops.run_id` is
 *  `REFERENCES lead_runs(id) ON DELETE CASCADE`, so the drop in step 4 with the key still
 *  pointing at the old table takes every assigned shop with it. That is not hypothetical in
 *  this repo: `tests/no-cascade-migration.test.ts` exists because a cascade once destroyed a
 *  driver's assigned work "with no error and no entry in any log". The row-count assertion is
 *  what stands between this function and that.
 *
 *  Guarded on `lead_runs` being absent, so it runs once — including on a database created
 *  fresh, where the table never existed.
 *
 *  Re-entering it safely is a SEPARATE property, and it did not hold before. Step 3 renames the
 *  rebuilt table into place, and SQLite rewrites the stored CREATE quoting the new name
 *  (`CREATE TABLE "lead_run_stops"`), so a later run can no longer recognise that table by its
 *  text — while a table that survived for some other reason may still be standing there. So
 *  step 3 asks `PRAGMA foreign_key_list` what `run_id` actually points at, and refuses only when
 *  the key genuinely says `lead_runs` and could not be re-pointed.
 */
function foldLeadRunsIntoDeliveryRuns(db: DatabaseSync): void {
  const has = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lead_runs'")
    .get();
  if (!has) return;

  const now = new Date().toISOString();
  const before = (db.prepare("SELECT COUNT(*) AS n FROM lead_run_stops").get() as { n: number })
    .n;

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    /* 1. kind. The DEFAULT matters: every row that already exists is a delivery run, and every
       row this function creates is marked 'mixed' explicitly. */
    const drCols = (db.prepare("PRAGMA table_info(delivery_runs)").all() as { name: string }[]).map(
      (c) => c.name
    );
    if (!drCols.includes("kind")) {
      db.exec(
        "ALTER TABLE delivery_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'delivery_only' " +
          "CHECK (kind IN ('delivery_only', 'mixed'))"
      );
    }

    /* 2. Move each run onto delivery_runs, keyed by (driver, date, org) — the same key the
       UNIQUE index uses, so a lead run for a day that ALREADY has a delivery run joins it
       rather than colliding with it. That merge is the bug this phase exists to fix, so it must
       not throw. */
    const leads = db
      .prepare("SELECT * FROM lead_runs ORDER BY id")
      .all() as unknown as Array<{
      id: number;
      driver_user_id: number;
      group_id: number | null;
      run_date: string;
      status: string;
      started_at: string | null;
      finished_at: string | null;
      notes: string | null;
      planned_by: number;
      organization_id: number;
      created_at: string;
      updated_at: string;
    }>;

    const findExisting = db.prepare(
      `SELECT id FROM delivery_runs
        WHERE driver_user_id = ? AND run_date = ? AND organization_id = ?`
    );
    const insertRun = db.prepare(
      `INSERT INTO delivery_runs
         (driver_user_id, group_id, run_date, status, started_at, finished_at, notes,
          created_by, organization_id, created_at, updated_at, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mixed')`
    );

    /* old lead_runs.id -> new delivery_runs.id. Step 3 rewrites through this and step 4's
       guard reads it. Without the map the rebuild would have to guess, and a guess here
       silently re-points a stop at whatever run happens to share the number. */
    db.exec(
      "CREATE TEMP TABLE IF NOT EXISTS _lead_run_map (old_id INTEGER PRIMARY KEY, new_id INTEGER NOT NULL)"
    );
    db.exec("DELETE FROM _lead_run_map");

    for (const lead of leads) {
      const existing = findExisting.get(
        lead.driver_user_id,
        lead.run_date,
        lead.organization_id
      ) as { id: number } | undefined;

      let newId: number;
      if (existing) {
        /* Merging into a day that already has a delivery run. The two statuses disagree by
           nature, and `done` is terminal, so it wins: a finished day stays finished rather than
           being reopened by a visit that was never driven. */
        const cur = db.prepare("SELECT status FROM delivery_runs WHERE id = ?").get(existing.id) as {
          status: string;
        };
        const status = cur.status === "done" || lead.status === "done" ? "done" : "in_progress";
        db.prepare(
          "UPDATE delivery_runs SET status = ?, kind = 'mixed', updated_at = ? WHERE id = ?"
        ).run(status, now, existing.id);
        newId = existing.id;
      } else {
        newId = Number(
          insertRun.run(
            lead.driver_user_id,
            lead.group_id,
            lead.run_date,
            lead.status,
            lead.started_at,
            lead.finished_at,
            lead.notes,
            lead.planned_by,
            lead.organization_id,
            lead.created_at,
            lead.updated_at
          ).lastInsertRowid
        );
      }
      db.prepare("INSERT INTO _lead_run_map (old_id, new_id) VALUES (?, ?)").run(lead.id, newId);
    }
/* 3. Rebuild lead_run_stops with run_id re-pointed at delivery_runs(id).
       The live CREATE is read out of sqlite_master and ONLY that one reference is rewritten.
       The copy-by-PRAGMA idiom is deliberately NOT applied to run_id: it would carry the old
       ids across verbatim, and the re-pointing is the entire point of this step. */
    const schema = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='lead_run_stops'")
      .get() as { sql: string } | undefined;
    if (!schema) throw new Error("foldLeadRuns: lead_run_stops is missing");

    /* What run_id ACTUALLY points at, asked of SQLite rather than read out of the CREATE text.

       PRAGMA foreign_key_list is the authority on this. The SQL string is only spelling, and
       this function changes that spelling under itself: step 3 ends in `ALTER TABLE
       lead_run_stops_fold_new RENAME TO lead_run_stops`, and SQLite rewrites the stored name in
       quotes — `CREATE TABLE "lead_run_stops"`. A regex over the text then no longer recognises
       a table this function has already been through, which is how the fold ended up unable to
       re-enter a database it had itself folded. */
    const runIdFk = (
      db.prepare("PRAGMA foreign_key_list('lead_run_stops')").all() as {
        from: string;
        table: string;
      }[]
    ).find((f) => f.from === "run_id");
    if (!runIdFk) {
      throw new Error(
        "foldLeadRuns: lead_run_stops.run_id carries no foreign key, so the rebuild below " +
          "cannot know what it is supposed to point at. Restore from backups/ before going further."
      );
    }

    /* The quote is optional in the name because step 3's own rename leaves it there. */
    const renamed = schema.sql.replace(
      /CREATE TABLE\s+"?lead_run_stops"?/i,
      "CREATE TABLE lead_run_stops_fold_new"
    );

    /* Already re-pointed: this database has been through step 3 before, so the key is ALREADY
       the correct one and is left exactly as it stands.

       Continuing is safe precisely because of that. The copy below still remaps run_id through
       _lead_run_map, so any run that has not moved yet is moved now, and the rebuilt table
       keeps the correct key. Refusing here is what turned a half-finished fold into a
       permanent outage: getDb() runs migrations, so the throw took down every request on
       data/routeflow.demo.db — where both lead tables were already empty and there was nothing
       to fold, restore or lose. */
    const newSql =
      runIdFk.table === "delivery_runs"
        ? renamed
        : renamed.replace("REFERENCES lead_runs(id)", "REFERENCES delivery_runs(id)");

    /* The alarm, kept and aimed at the case it was written for: the key still says lead_runs and
       the rebuild could not rewrite it, so the new table would carry the OLD key forward and the
       DROP below would take every stop with it. Both replaces being no-ops is not that test —
       the rename matching can mask a failed re-point — so this asks about the key directly. */
    if (runIdFk.table === "lead_runs" && newSql === renamed) {
      throw new Error(
        "foldLeadRuns: lead_run_stops.run_id references lead_runs(id) and the rebuild could not " +
          "re-point it — the DROP below would cascade every stop away. Restore from backups/ " +
          "before going further."
      );
    }
    const cols = (db.prepare("PRAGMA table_info(lead_run_stops)").all() as { name: string }[])
      .map((c) => `"${c.name}"`)
      .join(", ");
    /* Every column except run_id copies straight across, and `organization_id` is deliberately
       NOT added — this table has never had one and is reached through its run. */
    const copyCols = cols.replace(
      '"run_id"',
      `COALESCE(
        (SELECT m.new_id FROM _lead_run_map m WHERE m.old_id = lead_run_stops.run_id),
        lead_run_stops.run_id
      )`
    );

    db.exec(`
      ${newSql};
      INSERT INTO lead_run_stops_fold_new (${cols})
        SELECT ${copyCols} FROM lead_run_stops;
      DROP TABLE lead_run_stops;
      ALTER TABLE lead_run_stops_fold_new RENAME TO lead_run_stops;
      CREATE INDEX IF NOT EXISTS idx_lead_run_stops_run ON lead_run_stops(run_id, sort_order);
    `);

    /* The two assertions that stand between this function and a silent cascade. */
    const after = (db.prepare("SELECT COUNT(*) AS n FROM lead_run_stops").get() as { n: number })
      .n;
    if (after !== before) {
      throw new Error(
        `foldLeadRuns lost stops: ${before} before, ${after} after. lead_runs has NOT been ` +
          `dropped — restore from backups/ before going further.`
      );
    }
    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS n FROM lead_run_stops s
          WHERE NOT EXISTS (SELECT 1 FROM delivery_runs r WHERE r.id = s.run_id)`
      )
      .get() as { n: number };
    if (orphans.n > 0) {
      throw new Error(
        `foldLeadRuns left ${orphans.n} stops pointing at no run. lead_runs has NOT been ` +
          `dropped — restore from backups/ before going further.`
      );
    }

    /* 4. The drop, reached only because both assertions passed.
     *
     *  NOT a redundant safety net, and deliberately NOT claimed as one: SQLite treats
     *  `PRAGMA foreign_keys` as a NO-OP inside a transaction (verified against node:sqlite —
     *  the pragma reads back as 1 with the transaction open), so re-enabling here would do
     *  nothing at all. The guards that actually stand between this DROP and a silent cascade are
     *  the row-count and orphan assertions above; this DROP runs only because they passed.
     *  The `finally` block below restores enforcement for real, once the transaction is closed. */
    db.exec("DROP TABLE lead_runs");
    db.exec("DROP INDEX IF EXISTS idx_lead_runs_driver");
    db.exec("DROP TABLE IF EXISTS _lead_run_map");

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  console.info("[migrate] lead_runs folded into delivery_runs");
}

/** Phase 5: add 'ready' to delivery_runs.status. SQLite cannot ALTER a CHECK, and by the
 *  time this runs delivery_runs has picked up ten Phase-5 columns, so rather than
 *  hard-code a createSql this reads the live CREATE, rewrites just the CHECK list, and
 *  copies every column via PRAGMA table_info. Guarded on the CHECK already naming
 *  'ready'. */
function rebuildDeliveryRunsStatus(db: DatabaseSync): void {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='delivery_runs'")
    .get() as { sql: string } | undefined;
  if (!schema || schema.sql.includes("'ready'")) return;

  const newSql = schema.sql
    .replace(/CREATE TABLE\s+delivery_runs/i, "CREATE TABLE delivery_runs_dr_new")
    .replace(
      "CHECK (status IN ('planned', 'in_progress', 'done'))",
      "CHECK (status IN ('planned', 'ready', 'in_progress', 'done'))"
    );
  const cols = (db.prepare("PRAGMA table_info(delivery_runs)").all() as { name: string }[])
    .map((c) => `"${c.name}"`)
    .join(", ");

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN");
  try {
    db.exec(`
      ${newSql};
      INSERT INTO delivery_runs_dr_new (${cols}) SELECT ${cols} FROM delivery_runs;
      DROP TABLE delivery_runs;
      ALTER TABLE delivery_runs_dr_new RENAME TO delivery_runs;
      CREATE INDEX IF NOT EXISTS idx_delivery_runs_driver ON delivery_runs(driver_user_id, run_date);
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
  console.info("[migrate] delivery_runs.status gained 'ready'");
}

/** Phase 3: rebuild `orders` so `status` carries the 12+2-state machine instead of the
 *  old `draft / confirmed / delivered / cancelled`. Guarded on the CHECK already naming
 *  `PENDING_REVIEW`, so a fresh DB (whose `orders` came out of the updated
 *  `rebuildForTenantUnique` create) skips it and only a pre-Phase-3 production DB is
 *  actually rebuilt.
 *
 *  The value map folds the delivery state that used to live implicitly in
 *  `delivery_stops` back into the order itself: a `confirmed` order with a stop that is
 *  still `pending` was really `PLANNED`; one whose stop is `delivered` was `DELIVERED`.
 *  `credit_hold` rows are then reconciled against their `credit_approvals` row. */
function rebuildOrdersStatusMachine(db: DatabaseSync): void {
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'")
    .get() as { sql: string } | undefined;
  if (!schema || schema.sql.includes("PENDING_REVIEW")) return;

  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE orders_sm_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_no TEXT NOT NULL,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        group_id INTEGER REFERENCES groups(id),
        salesperson_user_id INTEGER REFERENCES users(id),
        status TEXT NOT NULL DEFAULT 'DRAFT'
          CHECK (status IN ('DRAFT', 'PENDING_REVIEW', 'PENDING_CREDIT', 'ON_HOLD',
                            'CONFIRMED', 'PLANNED', 'READY', 'OUT_FOR_DELIVERY',
                            'DELIVERED', 'PARTIALLY_DELIVERED', 'DELIVERY_FAILED',
                            'CLOSED', 'CANCELLED', 'RETURNED')),
        order_type TEXT NOT NULL DEFAULT 'SALE',
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        offline INTEGER NOT NULL DEFAULT 0,
        order_date TEXT NOT NULL,
        delivered_at TEXT,
        payment_status TEXT NOT NULL DEFAULT 'unpaid'
          CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
        paid_toman INTEGER NOT NULL DEFAULT 0,
        credit_override_by INTEGER REFERENCES users(id),
        credit_hold INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        organization_id INTEGER REFERENCES organizations(id),
        UNIQUE (organization_id, order_no)
      );

      INSERT INTO orders_sm_new
        (id, order_no, customer_id, group_id, salesperson_user_id, status,
         order_date, delivered_at, payment_status, paid_toman, credit_override_by,
         credit_hold, notes, created_by, created_at, updated_at, organization_id)
      SELECT
        o.id, o.order_no, o.customer_id, o.group_id, o.salesperson_user_id,
        CASE o.status
          WHEN 'draft' THEN 'DRAFT'
          WHEN 'cancelled' THEN 'CANCELLED'
          WHEN 'delivered' THEN 'DELIVERED'
          WHEN 'confirmed' THEN (
            SELECT CASE
              WHEN MAX(CASE WHEN ds.status = 'delivered' THEN 1 ELSE 0 END) = 1 THEN 'DELIVERED'
              WHEN COUNT(ds.id) > 0 THEN 'PLANNED'
              ELSE 'CONFIRMED'
            END
            FROM delivery_stops ds WHERE ds.order_id = o.id
          )
          ELSE 'DRAFT'
        END,
        o.order_date, o.delivered_at, o.payment_status, o.paid_toman, o.credit_override_by,
        COALESCE(o.credit_hold, 0), o.notes, o.created_by, o.created_at, o.updated_at,
        o.organization_id
      FROM orders o;

      DROP TABLE orders;
      ALTER TABLE orders_sm_new RENAME TO orders;
      CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, order_date);
      CREATE INDEX IF NOT EXISTS idx_orders_scope ON orders(group_id, status, order_date);
      CREATE INDEX IF NOT EXISTS idx_orders_salesperson ON orders(salesperson_user_id, order_date);

      /* A held order whose approval is still pending was really PENDING_CREDIT; one whose
         approval was rejected was ON_HOLD. Anything else keeps the mapped status. */
      UPDATE orders SET status = 'PENDING_CREDIT'
       WHERE credit_hold = 1 AND status IN ('DRAFT', 'CONFIRMED', 'PENDING_REVIEW')
         AND EXISTS (SELECT 1 FROM credit_approvals ca
                      WHERE ca.order_id = orders.id AND ca.status = 'pending');
      UPDATE orders SET status = 'ON_HOLD'
       WHERE credit_hold = 1 AND status IN ('DRAFT', 'CONFIRMED', 'PENDING_REVIEW')
         AND EXISTS (SELECT 1 FROM credit_approvals ca
                      WHERE ca.order_id = orders.id AND ca.status = 'rejected');
    `);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
  console.info("[migrate] orders.status widened to the 12-state machine");
}

/** Phase 1: before this deploy, a delivery stamped `orders.paid_toman` directly. After
 *  it, that column is a cache recomputed from `payment_allocations` -- so every legacy
 *  order with `paid_toman > 0` and no allocation needs a synthetic payment behind it,
 *  or the first `recomputeOrderPayment` on that customer would silently reset it to 0.
 *
 *  One CASH payment per such order, dated `delivered_at` (or the order date), attributed
 *  to `created_by`, allocated wholly to the order. If the recorded amount exceeds the
 *  order's own line total (bad legacy data) it is capped and the note says so. Guarded
 *  on an app_meta marker and self-guarded by the `NOT EXISTS` clause, so a re-run is a
 *  no-op. */
export function backfillLegacyPayments(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'legacy_payment_backfill_done'")
    .get() as { value: string } | undefined;
  if (done) return;

  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT o.id, o.customer_id, o.organization_id, o.created_by, o.paid_toman,
              COALESCE(o.delivered_at, o.order_date) AS when_paid,
              COALESCE((
                SELECT SUM(ROUND(COALESCE(ol.packs_delivered, ol.packs_ordered) * ol.unit_price_toman))
                  FROM order_lines ol WHERE ol.order_id = o.id
              ), 0) AS total_toman
         FROM orders o
        WHERE o.paid_toman > 0
          AND NOT EXISTS (SELECT 1 FROM payment_allocations a WHERE a.order_id = o.id)`
    )
    .all() as Array<{
    id: number;
    customer_id: number;
    organization_id: number | null;
    created_by: number;
    paid_toman: number;
    when_paid: string;
    total_toman: number;
  }>;

  db.exec("BEGIN IMMEDIATE");
  try {
    const insPay = db.prepare(
      `INSERT INTO payments
         (organization_id, customer_id, amount_toman, method, received_at, received_by, note, created_at)
       VALUES (?, ?, ?, 'CASH', ?, ?, ?, ?)`
    );
    const insAlloc = db.prepare(
      "INSERT INTO payment_allocations (payment_id, order_id, amount_toman, created_at) VALUES (?, ?, ?, ?)"
    );
    for (const o of rows) {
      const cap = o.total_toman > 0 ? Math.min(o.paid_toman, o.total_toman) : o.paid_toman;
      const note =
        cap < o.paid_toman
          ? "انتقال از سیستم قبلی (سقف‌گذاری‌شده)"
          : "انتقال از سیستم قبلی";
      const paymentId = Number(
        insPay.run(o.organization_id ?? 1, o.customer_id, cap, o.when_paid, o.created_by, note, now)
          .lastInsertRowid
      );
      insAlloc.run(paymentId, o.id, cap, now);
    }
    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('legacy_payment_backfill_done', ?)"
    ).run(now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Phase 2: turn the legacy derived-stock world into a movement ledger. Every purchase
 *  line becomes a batch (LEGACY-PL<id>, undated) plus a PURCHASE_IN; every delivered
 *  order line becomes DELIVERY_OUT movements against those batches, oldest first. The
 *  invariant this preserves is per-product on-hand -- after the run,
 *  SUM(stock_movements.base_qty) for a product equals the old purchased minus delivered.
 *  Guarded on an app_meta marker and by per-row existence checks, so a re-run is a
 *  no-op. Pure SQL here rather than lib/repo to avoid a db.ts <-> repo import cycle. */
export function seedAccounts(db: DatabaseSync): void {
  /* The leading digit carries the statement, so a code can be read without opening the
     row: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx expenses. The
     first draft of the spec numbered equity 22xx and revenue 41xx while the group headers
     claimed 3000 and 4000 -- each sitting inside the previous category's block, which is
     exactly what a code exists to prevent. tests/ledger-schema.test.ts asserts the
     invariant so it cannot drift back.

     Idempotent by code, so it runs on every boot. is_system=1 marks these as the shared
     taxonomy rather than a tenant's own additions: a user may ADD accounts, never edit
     these, and retiring one is active=0, never a delete (see accounts_no_delete). */
  const rows: ReadonlyArray<readonly [string, string, string, string, string, number]> = [
    // code,   name_fa,               name_en,               type,        normal_balance, is_postable
    ["1000", "دارایی‌ها", "Assets", "ASSET", "DEBIT", 0],
    ["1101", "صندوق", "Cash on hand", "ASSET", "DEBIT", 1],
    ["1102", "بانک", "Bank account", "ASSET", "DEBIT", 1],
    ["1103", "تنخواه گردان", "Petty cash", "ASSET", "DEBIT", 1],
    ["1201", "حساب‌های دریافتنی", "Accounts receivable", "ASSET", "DEBIT", 1],
    ["1202", "چک‌های دریافتنی", "Cheques receivable", "ASSET", "DEBIT", 1],
    ["1203", "موجودی کالا", "Inventory", "ASSET", "DEBIT", 1],
    ["1301", "پیش‌پرداخت", "Prepayments", "ASSET", "DEBIT", 1],
    ["2000", "بدهی‌ها", "Liabilities", "LIABILITY", "CREDIT", 0],
    ["2101", "حساب‌های پرداختنی", "Accounts payable", "LIABILITY", "CREDIT", 1],
    ["2102", "چک‌های پرداختنی", "Cheques payable", "LIABILITY", "CREDIT", 1],
    /* 2103 exists because the commission subsystem already knows what a rep is owed.
       Without a liability here, commission is invisible on the balance sheet: the app
       knows the number and the books do not. */
    ["2103", "تعهدات کمیسیون", "Commission payable", "LIABILITY", "CREDIT", 1],
    /* 2104 is seeded and never written in this slice. It is the seam for the tax reporting
       Q2 deferred: a VAT line can later map to an account that has existed since day one,
       rather than a schema change on posted history. */
    ["2104", "مالیات پرداختنی", "Taxes payable", "LIABILITY", "CREDIT", 1],
    ["3000", "سرمایه", "Equity", "EQUITY", "CREDIT", 0],
    ["3101", "سرمایه اولیه", "Capital", "EQUITY", "CREDIT", 1],
    ["3102", "برداشت و اضافه‌برداشت", "Owner's drawings", "EQUITY", "DEBIT", 1],
    ["3103", "سود انباشته", "Retained earnings", "EQUITY", "CREDIT", 1],
    ["4000", "درآمدها", "Revenue", "REVENUE", "CREDIT", 0],
    ["4101", "فروش", "Sales revenue", "REVENUE", "CREDIT", 1],
    ["4102", "برگشت از فروش", "Sales returns", "REVENUE", "DEBIT", 1],
    ["5000", "هزینه‌ها", "Expenses", "EXPENSE", "DEBIT", 0],
    /* 5101 is COGS and is posted by delivery recognition, never entered by hand. It is
       excluded from the expense dropdown: a manual expense against it would double-count
       the cost of goods already recognised on the sale. */
    ["5101", "بهای تمام‌شده", "Cost of goods sold", "EXPENSE", "DEBIT", 1],
    ["5102", "اجاره", "Rent", "EXPENSE", "DEBIT", 1],
    ["5103", "حقوق", "Salary", "EXPENSE", "DEBIT", 1],
    ["5104", "سوخت و حمل", "Fuel and delivery", "EXPENSE", "DEBIT", 1],
    ["5105", "تلفن و اینترنت", "Phone and internet", "EXPENSE", "DEBIT", 1],
    ["5106", "سایر", "Other expenses", "EXPENSE", "DEBIT", 1],
  ];
  const ins = db.prepare(
    `INSERT INTO accounts (code, name_fa, name_en, type, normal_balance, is_postable, is_system, active)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)
     ON CONFLICT(code) DO NOTHING`
  );
  for (const r of rows) ins.run(r[0], r[1], r[2], r[3], r[4], r[5]);
}

/** Turn existing payments into ledger postings.
 *
 *  There is deliberately NO app_meta marker here, and
 *  tests/no-one-shot-data-migration.test.ts is why. A marker is the right tool when a
 *  migration converts an old REPRESENTATION that stops existing afterwards -- the three
 *  exemptions in that file are all of that kind, where `paid_toman` is dropped and a row
 *  arriving later is already in the new shape.
 *
 *  This is not that. A `payments` row survives the backfill and is the screen's own
 *  source of truth, so "have I posted it yet" is a fact about a ROW, not about time.
 *  Guarded on a marker, every receipt taken after the first boot would be silently
 *  unposted -- which is precisely the quiet divergence the ledger section exists to
 *  prevent. My first draft had the marker and was caught by that test.
 *
 *  So the predicate is per-row and lives in the query: `NOT EXISTS` on
 *  (source_type, source_id) is both the work list and the idempotency proof. Running on
 *  every boot is cheap -- it is one indexed anti-join over payments -- and it is correct
 *  by construction rather than correct-until-someone-adds-a-payment.
 *
 *  Voided payments are skipped: they have a reversal, not a receipt. Historical orders
 *  are NOT recognised for revenue here, because product_costs is effective-dated and new
 *  and today's average is not what the goods cost then -- a wrong number that looks
 *  right is worse than an absent one. That P&L is labelled cost-incomplete.
 *
 *  The receipt is ONLY cash/bank vs receivables. It does not recognise revenue even when
 *  the payment is allocated to orders: the cash arrived and the debt fell, which is a
 *  different event from the goods moving. Recognition posts on delivery (Task 7). */
export function backfillLedger(db: DatabaseSync): void {
  const acct = (code: string) =>
    db.prepare("SELECT id FROM accounts WHERE code = ?").get(code) as { id: number } | undefined;
  const cash = acct("1101");
  const bank = acct("1102");
  const ar = acct("1201");
  // The chart has not been seeded yet; leave the marker unset so a later boot does the work.
  if (!cash || !bank || !ar) return;

  const rows = db
    .prepare(
      `SELECT p.id, p.organization_id, p.customer_id, p.amount_toman, p.method,
              p.received_at, p.received_by
         FROM payments p
        WHERE p.voided_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM journals j
             WHERE j.source_type = 'PAYMENT' AND j.source_id = p.id
          )`
    )
    .all() as Array<{
    id: number;
    organization_id: number | null;
    customer_id: number;
    amount_toman: number;
    method: string;
    received_at: string;
    received_by: number;
  }>;

  /* CREDIT_NOTE and OTHER are NOT silently treated as bank. A credit note is not money
     received, and 'OTHER' says nothing about where the value went; posting either to
     1102 invents a fact. They are recorded as UNMAPPED for a human instead -- see
     unmappedBackfillPayments() -- and the reconciliation test asserts the count, so the
     gap between payments and the ledger is visible rather than quiet. */
  const mappable = rows.filter((p) => p.method !== "CREDIT_NOTE" && p.method !== "OTHER");

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const p of mappable) {
      const cashAccount = p.method === "CASH" ? cash.id : bank.id;
      postJournal(db, {
        organizationId: p.organization_id ?? 1,
        postedAt: p.received_at,
        sourceType: "PAYMENT",
        sourceId: p.id,
        createdBy: p.received_by,
        memo: "انتقال از سیستم قبلی",
        legs: [
          { accountId: cashAccount, side: "D", amountToman: p.amount_toman },
          {
            accountId: ar.id,
            side: "C",
            amountToman: p.amount_toman,
            customerId: p.customer_id,
          },
        ],
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Payments the backfill deliberately did NOT post, because no account honestly holds
 *  them. Returned rather than logged so the reconciliation gate can assert on the number
 *  and a future report can offer a human a list to fix. */
export function unmappedBackfillPayments(db: DatabaseSync): {
  id: number;
  amount_toman: number;
  method: string;
  received_at: string;
}[] {
  return db
    .prepare(
      `SELECT p.id, p.amount_toman, p.method, p.received_at
         FROM payments p
        WHERE p.voided_at IS NULL
          AND p.method IN ('CREDIT_NOTE','OTHER')
          AND NOT EXISTS (
            SELECT 1 FROM journals j
             WHERE j.source_type = 'PAYMENT' AND j.source_id = p.id
          )`
    )
    .all() as { id: number; amount_toman: number; method: string; received_at: string }[];
}

/** Fold the free-text purchases.supplier into real supplier rows and give purchases a
 *  supplier_id.
 *
 *  Rebuild-and-copy, because SQLite cannot add a foreign key to an existing table --
 *  the same reason payments.cheque_id has none. Idempotent two ways: the PRAGMA check
 *  short-circuits a re-run, and INSERT OR IGNORE on the unique index is the guard that
 *  keeps a re-run from creating duplicate suppliers.
 *
 *  The legacy `supplier` TEXT column is KEPT. It is the only record of the original
 *  string when two suppliers normalise to the same name after trimming, and dropping it
 *  buys tidiness at the price of irreversible data loss.
 *
 *  `organization_id` is carried through as-is: the boot backfill stamps it before this
 *  runs, and COALESCE only covers a hand-seeded row. */
export function migratePurchaseSuppliers(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(purchases)").all() as { name: string }[];
  if (cols.some((c) => c.name === "supplier_id")) return; // already migrated

  const now = new Date().toISOString();
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchases_tn_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier TEXT,
        supplier_id INTEGER REFERENCES suppliers(id),
        purchase_date TEXT NOT NULL,
        invoice_no TEXT,
        notes TEXT,
        created_by INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        organization_id INTEGER
      );
      INSERT INTO purchases_tn_new
        (id, supplier, purchase_date, invoice_no, notes, created_by, created_at, organization_id)
      SELECT id, supplier, purchase_date, invoice_no, notes, created_by, created_at, organization_id
        FROM purchases;
      DROP TABLE purchases;
      ALTER TABLE purchases_tn_new RENAME TO purchases;
    `);
    /* OR IGNORE against ux_suppliers_org_name, and the name is TRIM'd because two
       spellings with stray whitespace are the same vendor far more often than not. */
    db.prepare(
      `INSERT OR IGNORE INTO suppliers (organization_id, name, created_at)
       SELECT DISTINCT COALESCE(organization_id, 1), TRIM(supplier), ?
         FROM purchases WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''`
    ).run(now);
    db.prepare(
      `UPDATE purchases SET supplier_id = (
         SELECT s.id FROM suppliers s
          WHERE s.name = TRIM(purchases.supplier)
            AND s.organization_id = COALESCE(purchases.organization_id, 1))
       WHERE supplier IS NOT NULL AND TRIM(supplier) <> ''`
    ).run();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

export function backfillStockLedger(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'stock_ledger_backfill_done'")
    .get() as { value: string } | undefined;
  if (done) return;

  const facility = db
    .prepare(
      "SELECT id FROM facilities ORDER BY (kind <> 'warehouse'), (kind <> 'home_base'), id LIMIT 1"
    )
    .get() as { id: number } | undefined;
  if (!facility) {
    // No facility to attach stock to yet -- seedFacilities has not run. Leave the marker
    // unset so the next boot (after seeding) does the work.
    return;
  }
  const facilityId = facility.id;
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    // --- purchases -> batches + PURCHASE_IN -----------------------------------------
    const purchaseLines = db
      .prepare(
        `SELECT pl.id, pl.product_id, pl.base_qty, pl.unit_cost_toman,
                pu.purchase_date, COALESCE(pu.organization_id, 1) AS org
           FROM purchase_lines pl JOIN purchases pu ON pu.id = pl.purchase_id
          WHERE NOT EXISTS (SELECT 1 FROM batches b WHERE b.purchase_line_id = pl.id)`
      )
      .all() as Array<{
      id: number;
      product_id: number;
      base_qty: number;
      unit_cost_toman: number;
      purchase_date: string;
      org: number;
    }>;

    const insBatch = db.prepare(
      `INSERT INTO batches
         (organization_id, product_id, batch_code, purchase_line_id, produced_at, expiry_date,
          qty_received_base, unit_cost_toman, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'active', ?, ?)`
    );
    const insMove = db.prepare(
      `INSERT INTO stock_movements
         (organization_id, facility_id, product_id, batch_id, base_qty, kind, ref_type, ref_id,
          occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const pl of purchaseLines) {
      const batchId = Number(
        insBatch.run(
          pl.org,
          pl.product_id,
          `LEGACY-PL${pl.id}`,
          pl.id,
          pl.purchase_date,
          pl.base_qty,
          pl.unit_cost_toman,
          now,
          now
        ).lastInsertRowid
      );
      insMove.run(
        pl.org,
        facilityId,
        pl.product_id,
        batchId,
        pl.base_qty,
        "PURCHASE_IN",
        "purchase_line",
        pl.id,
        pl.purchase_date,
        now
      );
    }

    // --- deliveries -> DELIVERY_OUT (oldest batch first) --------------------------
    const deliveredLines = db
      .prepare(
        `SELECT ol.id, ol.product_id, ol.order_id,
                (COALESCE(ol.packs_delivered, 0) * ol.qty_per_pack) AS base_qty,
                COALESCE(o.delivered_at, o.order_date) AS occurred_at,
                COALESCE(o.organization_id, 1) AS org
           FROM order_lines ol JOIN orders o ON o.id = ol.order_id
          WHERE o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)}) AND COALESCE(ol.packs_delivered, 0) > 0
            AND NOT EXISTS (SELECT 1 FROM delivery_line_batches d WHERE d.order_line_id = ol.id)
            AND NOT EXISTS (SELECT 1 FROM stock_movements m
                             WHERE m.ref_type = 'order_line' AND m.ref_id = ol.id AND m.kind = 'DELIVERY_OUT')
          ORDER BY occurred_at, ol.id`
      )
      .all() as Array<{
      id: number;
      product_id: number;
      order_id: number;
      base_qty: number;
      occurred_at: string;
      org: number;
    }>;

    const insDlb = db.prepare(
      `INSERT INTO delivery_line_batches
         (organization_id, delivery_stop_id, order_line_id, batch_id, base_qty, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const stopForOrder = db.prepare(
      "SELECT id FROM delivery_stops WHERE order_id = ? ORDER BY id LIMIT 1"
    );

    // Running on-hand per batch, seeded from the PURCHASE_IN rows just written.
    const onHandByBatch = new Map<number, number>();
    for (const r of db
      .prepare(
        "SELECT batch_id, COALESCE(SUM(base_qty), 0) AS n FROM stock_movements WHERE batch_id IS NOT NULL GROUP BY batch_id"
      )
      .all() as Array<{ batch_id: number; n: number }>) {
      onHandByBatch.set(r.batch_id, r.n);
    }

    const batchesForProduct = db.prepare(
      `SELECT id FROM batches WHERE product_id = ? AND organization_id = ?
        ORDER BY (expiry_date IS NULL), expiry_date, id`
    );

    for (const dl of deliveredLines) {
      let left = dl.base_qty;
      const stop = stopForOrder.get(dl.order_id) as { id: number } | undefined;
      const batchIds = (batchesForProduct.all(dl.product_id, dl.org) as Array<{ id: number }>).map(
        (b) => b.id
      );

      for (const bId of batchIds) {
        if (left <= 1e-9) break;
        const avail = onHandByBatch.get(bId) ?? 0;
        if (avail <= 0) continue;
        const take = Math.min(left, avail);
        insMove.run(
          dl.org,
          facilityId,
          dl.product_id,
          bId,
          -take,
          "DELIVERY_OUT",
          "order_line",
          dl.id,
          dl.occurred_at,
          now
        );
        if (stop) insDlb.run(dl.org, stop.id, dl.id, bId, take, now);
        onHandByBatch.set(bId, avail - take);
        left -= take;
      }

      if (left > 1e-9) {
        // Oversold beyond every batch -- an unbatched shortfall, so on-hand still goes
        // negative rather than the delivery vanishing.
        insMove.run(
          dl.org,
          facilityId,
          dl.product_id,
          null,
          -left,
          "DELIVERY_OUT",
          "order_line",
          dl.id,
          dl.occurred_at,
          now
        );
        if (stop) insDlb.run(dl.org, stop.id, dl.id, null, left, now);
      }
    }

    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('stock_ledger_backfill_done', ?)"
    ).run(now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Phase 3: the order machine's audit view reads `order_events`. Legacy orders predate
 *  the table, so give each one a single synthetic `create` row -- `from_status` NULL,
 *  `to_status` its current status, dated and attributed from the order itself -- so the
 *  timeline is never blank. Guarded on an app_meta marker; the `NOT EXISTS` clause makes
 *  a stray re-run a no-op too. Pure SQL, same reason as backfillStockLedger. */
export function backfillOrderEvents(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'order_events_backfill_done'")
    .get() as { value: string } | undefined;
  if (done) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      INSERT INTO order_events
        (organization_id, order_id, from_status, to_status, action, actor_user_id,
         reason_code_id, note, device_time, created_at)
      SELECT COALESCE(o.organization_id, 1), o.id, NULL, o.status, 'create', o.created_by,
             NULL, NULL, NULL, o.created_at
        FROM orders o
       WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id);
    `);
    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('order_events_backfill_done', ?)"
    ).run(new Date().toISOString());
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Board & Pocket: fold every customer-scoped `reminders` row into the Phase 7 `tasks`
 *  spine as `kind='reminder'`, so the Pocket and the Board see it and new customer
 *  reminders can route through `tasks` from here on. District reminders stay on the map.
 *  Guarded on an app_meta marker; the `NOT EXISTS` clause makes a stray re-run a no-op
 *  too. organization_id / group_id come from the customer. */
export function backfillReminderTasks(db: DatabaseSync): void {
  const done = db
    .prepare("SELECT value FROM app_meta WHERE key = 'board_pocket_reminders_folded'")
    .get() as { value: string } | undefined;
  if (done) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      INSERT INTO tasks
        (organization_id, assignee_user_id, role_hint, group_id, kind, title,
         entity_type, entity_id, due_at, priority, status, outcome_code, outcome_note,
         created_by, created_at, done_at, stage)
      SELECT c.organization_id, NULL, 'salesperson', c.group_id, 'reminder', r.message,
             'customer', r.entity_id, r.due_date, 'NORMAL',
             CASE WHEN r.resolved = 1 THEN 'done' ELSE 'open' END, NULL, NULL,
             NULL, r.created_at,
             CASE WHEN r.resolved = 1 THEN r.created_at ELSE NULL END, NULL
        FROM reminders r
        JOIN customers c ON c.id = r.entity_id
       WHERE r.entity_type = 'customer'
         AND NOT EXISTS (
           SELECT 1 FROM tasks t
            WHERE t.kind = 'reminder' AND t.entity_type = 'customer'
              AND t.entity_id = r.entity_id AND t.title = r.message
              AND t.created_at = r.created_at
         );
    `);
    db.prepare(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('board_pocket_reminders_folded', ?)"
    ).run("1");
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Phase 0b: a pin that made it into a lead list is a relationship worth tracking, not
 *  just a dot on the map. Promote each such saved_location to a `customers` row
 *  (`lifecycle='lead'`, code `LEAD-<id>` -- the same scheme /api/locations/[id]/convert
 *  uses, so it cannot collide with a manually-converted pin) and delete the pin and its
 *  list membership. Pins in no list stay as pins. Idempotent: `ON CONFLICT DO NOTHING`
 *  on the code, so a second run is a no-op. */
/** What one pass of the fold did. Returned, not merely logged, because the whole failure
 *  mode of this migration is silence: a pin silently not promoted, a stop silently
 *  destroyed. A test can assert a return value; it cannot assert a log line. */
export interface LeadPinFoldResult {
  /** Pins promoted to `customers` and deleted from `saved_locations`. */
  promoted: number[];
  /** Pins left alone because a `lead_run_stops` row points at them. */
  skipped: number[];
}

export function foldLeadPinsIntoCustomers(db: DatabaseSync): LeadPinFoldResult {
  /* NOT EXISTS is the whole precondition, and it is unconditional.
   *
   * lead_run_stops.location_id is `REFERENCES saved_locations(id) ON DELETE CASCADE`
   * (schema), and the loop below issues a hand-written `DELETE FROM saved_locations`.
   * So promoting a pin that is on a run would delete the pin, the cascade would take the
   * stop with it, and SQLite would call the whole transaction correct. A driver's
   * assigned work — a promise the office made that morning — gone, silently.
   *
   * The count of affected rows cannot be measured in advance: on a dev database it is a
   * handful, on a real one it is zero or every run in the business. So the guard does not
   * depend on the count.
   *
   * A finished run releases its leads. The join and the `status != 'done'` are the same
   * rule `readLeadRunAssignments` already reasons about (lib/repo/leadRuns.ts:149), not a
   * new one invented here — so the pin is promoted on a later boot rather than never. The
   * migration is eventually consistent with the runs, not destructive to them.
   *
   * The join is what makes that work. Checking only `lead_run_stops` would skip the pin
   * FOREVER, because the stop row outlives the run's status: a run that finished still
   * has its stops, and a stop is the thing whose deletion we are avoiding.
   *
   * `lead_import_items` is here too, and it is the one that bites. A pasted import row
   * carries `saved_location_id INTEGER REFERENCES saved_locations(id)` (lib/db.ts:1069) —
   * no CASCADE, no NOT NULL, so `PRAGMA foreign_key_check` reports nothing for it, and a
   * read of the schema's CASCADE clauses alone would miss it too. Deleting such a pin
   * raises FOREIGN KEY constraint failed and aborts the whole transaction, which on a real
   * database meant /leads could not boot at all. Every referrer gets a vote, because the
   * question is "does any row still point at this pin", not "does any row CASCADE". */
  const pins = db
    .prepare(
      `SELECT DISTINCT s.id, s.name, s.address, s.lat, s.lng, s.notes, s.group_id, s.organization_id
         FROM saved_locations s
         JOIN lead_list_items i ON i.location_id = s.id
        WHERE NOT EXISTS (
                SELECT 1 FROM lead_run_stops st
                  JOIN delivery_runs r ON r.id = st.run_id
                 WHERE st.location_id = s.id AND r.status != 'done')
          AND NOT EXISTS (
                SELECT 1 FROM lead_import_items ii WHERE ii.saved_location_id = s.id)`
    )
    .all() as Array<{
    id: number;
    name: string;
    address: string | null;
    lat: number | null;
    lng: number | null;
    notes: string | null;
    group_id: number | null;
    organization_id: number;
  }>;
  /* Every pin that is in a list AND still pointed at by something — the SAME predicate
     the SELECT above uses, so the two cannot disagree. Counted before the loop so the
     number reported is the number DECLINED, not merely what is left over: a skipped pin
     is still a pin, and the operator is the one who needs to hear about it. */
  const skipped = (
    db
      .prepare(
        `SELECT s.id FROM saved_locations s
           JOIN lead_list_items i ON i.location_id = s.id
          WHERE EXISTS (
                  SELECT 1 FROM lead_run_stops st
                    JOIN delivery_runs r ON r.id = st.run_id
                   WHERE st.location_id = s.id AND r.status != 'done')
             OR EXISTS (
                  SELECT 1 FROM lead_import_items ii WHERE ii.saved_location_id = s.id)`,
      )
      .all() as unknown as { id: number }[]
  ).map((r) => r.id);

  if (pins.length === 0) {
    if (skipped.length > 0) reportFold(0, skipped);
    return { promoted: [], skipped };
  }

  const insert = db.prepare(
    `INSERT INTO customers (customer_code, business_name, address, lat, lng, notes,
                            lifecycle, group_id, organization_id, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, 'lead', ?, ?, ?)
     ON CONFLICT (organization_id, customer_code) DO NOTHING`
  );
  const now = new Date().toISOString();

  db.exec("BEGIN");
  try {
    for (const p of pins) {
      insert.run(`LEAD-${p.id}`, p.name, p.address, p.lat, p.lng, p.notes, p.group_id, p.organization_id, now);
      db.prepare("DELETE FROM lead_list_items WHERE location_id = ?").run(p.id);
      db.prepare("DELETE FROM saved_locations WHERE id = ?").run(p.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const promotedIds = pins.map((p) => p.id);
  reportFold(promotedIds, skipped);
  return { promoted: promotedIds, skipped };
}

/** One line, so an operator can see a fold that declined work without opening a log file.
 *  Silent is the failure mode this whole migration is about. */
function reportFold(promoted: number | number[], skipped: number[]): void {
  const n = typeof promoted === "number" ? promoted : promoted.length;
  if (n === 0 && skipped.length === 0) return;
  console.log(
    `[lead-pin-fold] ${n} promoted, ${skipped.length} waiting on a run` +
      (skipped.length ? ` (${skipped.join(", ")})` : ""),
  );
}

export function getDb(): DatabaseSync {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT UNIQUE NOT NULL,
      business_name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      province TEXT,
      lat REAL,
      lng REAL,
      status TEXT,
      salesperson TEXT,
      debt_0_7 REAL DEFAULT 0,
      debt_8_30 REAL DEFAULT 0,
      debt_30_plus REAL DEFAULT 0,
      notes TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS districts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('mantaghe', 'mahalle')),
      parent_name TEXT,
      boundary_geojson TEXT NOT NULL,
      coverage_status TEXT NOT NULL DEFAULT 'unknown'
        CHECK (coverage_status IN ('visited', 'needs_coverage', 'not_allowed', 'unknown')),
      notes TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE(name, level, parent_name)
    );

    /* Iranian public holidays that CANNOT be computed.
     *
     *  The Solar Hijri fixed ones (Nowruz, Sizdah Bedar, Bahman 22, …) are generated by
     *  lib/holidays.ts and are deliberately NOT stored: they are a pure function of the
     *  Jalali year, so a stored copy is a second source of truth that goes stale the moment
     *  one date is wrong.
     *
     *  This table holds only what a computer cannot know. Iran runs three calendars, and its
     *  Islamic holidays are Lunar Hijri — Eid al-Fitr, Eid al-Adha, Tasua, Ashura, Mawlid.
     *  Those move against the Gregorian calendar every year and are set by moon sighting, so
     *  an owner records them once a year. That is not a workaround; it is how every Iranian
     *  HR system does it.
     *
     *  No organization_id, for the same reason districts has none: a national holiday is
     *  the same in every tenant on this server, and a scope column that is always NULL
     *  invites a filter that empties a calendar. */
    CREATE TABLE IF NOT EXISTS holidays (
      iso_date TEXT PRIMARY KEY,
      title_fa TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'official'
        CHECK (kind IN ('official', 'commemorative')),
      /* True for a row an owner entered — i.e. one lib/holidays.ts cannot compute. Kept
       * for the admin screen's "these need confirming each year" hint. */
      is_lunar INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL
    );

    /* Tiny key/value store for one-shot migration markers and the like. Not tenant data. */
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'facility', 'lead_location')),
      entity_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('status_change', 'note', 'assigned')),
      old_value TEXT,
      new_value TEXT,
      note TEXT,
      changed_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id, created_at);

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer')),
      entity_id INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      message TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(resolved, due_date);

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer')),
      entity_id INTEGER NOT NULL,
      file_stem TEXT UNIQUE NOT NULL,
      caption TEXT,
      taken_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_id, taken_at);

    CREATE TABLE IF NOT EXISTS visit_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'facility', 'lead_location')),
      entity_id INTEGER NOT NULL,
      planned_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visit_plans_date ON visit_plans(planned_date);

    CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
    CREATE INDEX IF NOT EXISTS idx_districts_name ON districts(name);

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT,
      sale_date TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      product_name TEXT,
      qty REAL,
      amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT,
      shipping_status TEXT,
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_name, sale_date);
    CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(customer_name, product_name);

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    /* A tenant. RouteFlow is sold to other distributors, so one database holds several
       independent companies; organization_id on every business table is the boundary
       between them, and lib/session.ts is where it is enforced. Seeded with exactly one
       row for the company this database was built for -- see the migration below. */
    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      plan TEXT NOT NULL DEFAULT 'standard',
      active INTEGER NOT NULL DEFAULT 1,
      contact_name TEXT,
      contact_phone TEXT,
      created_at TEXT NOT NULL
    );

    /* One row per time a platform_owner (the vendor) reads a tenant's data that is not
       their own. Support access that leaves a trace is a different thing from support
       access that does not: if a tenant asks what was looked at, the answer is a query
       rather than a recollection. Written by lib/platformAccess.ts. */
    CREATE TABLE IF NOT EXISTS platform_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_user_id INTEGER NOT NULL REFERENCES users(id),
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      path TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );

    /* Phase 0b M2: a representative IS a wholesale customer (customer_type='WHOLESALE',
       its own lifecycle) plus this managed-relationship record. One Order table serves
       both direct customers and reps. */
    CREATE TABLE IF NOT EXISTS representative_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      rep_code TEXT NOT NULL,
      manager_user_id INTEGER REFERENCES users(id),
      contract_signed_at TEXT,
      contract_expires_at TEXT,
      exclusivity_territory_id INTEGER REFERENCES districts(id),
      stage TEXT NOT NULL DEFAULT 'prospect' CHECK (stage IN
        ('prospect','qualified','negotiating','documents','approved','onboarding','active','dormant','terminated')),
      activated_at TEXT,
      first_order_at TEXT,
      credit_terms_days INTEGER NOT NULL DEFAULT 0,
      discount_tier TEXT,
      monthly_target_kg REAL,
      monthly_target_toman INTEGER,
      health_score REAL,
      health_computed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, customer_id),
      UNIQUE (organization_id, rep_code)
    );

    /* Phase 0b M2: an order that breaches a direct customer's credit limit parks here
       for a manager to approve or reject. Direct customers only -- reps buy on cash or
       bank cheque, so the flow refuses a rep customer at request time. The automatic
       "order over limit -> PENDING_CREDIT" trigger arrives with the order state machine
       in Phase 3; for now this is a table plus a manual decide surface. */
    CREATE TABLE IF NOT EXISTS credit_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      order_id INTEGER NOT NULL REFERENCES orders(id),
      requested_by INTEGER NOT NULL REFERENCES users(id),
      requested_at TEXT NOT NULL,
      customer_balance_toman INTEGER NOT NULL,
      credit_limit_toman INTEGER,
      overage_toman INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
      decided_by INTEGER REFERENCES users(id),
      decided_at TEXT,
      reason TEXT
    );

    /* Reaches a tenant through representative_profiles, so it is not in TENANT_TABLES. */
    CREATE TABLE IF NOT EXISTS representative_onboarding_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      representative_id INTEGER NOT NULL REFERENCES representative_profiles(id) ON DELETE CASCADE,
      step_code TEXT NOT NULL,
      label_fa TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      completed_by INTEGER REFERENCES users(id),
      notes TEXT,
      UNIQUE (representative_id, step_code)
    );

    /* A group is one management team covering part of Tehran province. Territory is
       expressed by assigning districts to a group (districts.group_id), not by drawing
       new geometry -- the 22 منطقه and 369 محله polygons are already surveyed, and a
       second boundary system would be a second thing to disagree with the first. */
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'group_manager'
        CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'rep_manager', 'phone_sales', 'field_rep', 'delivery_driver', 'salesperson', 'driver')),
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      staff_code TEXT,
      phone TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 0,
      location_consent_at TEXT,
      created_at TEXT NOT NULL
    );

    /* A person's roles as a SET, while users.role stays their primary.
     *
     *  Every query asking "who can do X" reads this table and never users.role — a single
     *  column cannot say that someone both drives a delivery round and visits doors, and
     *  reading the primary instead is how a driver silently becomes unreachable.
     *  See lib/userRoles.ts, which is the only module that queries it. */
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role    TEXT NOT NULL,
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE IF NOT EXISTS saved_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      maps_url TEXT UNIQUE NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      resolution TEXT NOT NULL DEFAULT 'unresolved'
        CHECK (resolution IN ('direct', 'pluscode', 'browser', 'nominatim', 'manual', 'unresolved')),
      notes TEXT,
      organization_id INTEGER REFERENCES organizations(id),
      group_id INTEGER REFERENCES groups(id),
      status TEXT CHECK (status IN ('contacted', 'visited', 'no_answer', 'declined')),
      visit_outcome TEXT,
      rating_potential INTEGER,
      rating_volume INTEGER,
      rating_ease INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_locations_name ON saved_locations(name);

    /* A bulk maps-link import, as a job rather than one long request.
       lead_import_jobs is one row per paste; lead_import_items is one row per link.
       Both carry organization_id and are listed in TENANT_TABLES, so a forgotten scope
       is a compile error rather than a cross-tenant read.

       Why the items table rather than a JSON blob on the job: a 1000-link paste is
       written incrementally as each link resolves, so a refresh mid-run reads back
       exactly what finished, and a server restart resumes from the pending rows
       without re-resolving anything. A single JSON column would have to be rewritten
       whole on every one of a thousand updates. */
    CREATE TABLE IF NOT EXISTS lead_import_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      group_id INTEGER REFERENCES groups(id),
      status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'done', 'cancelled')),
      stage TEXT NOT NULL DEFAULT 'parse'
        CHECK (stage IN ('parse', 'fast', 'browser', 'nominatim', 'finish')),
      total INTEGER NOT NULL DEFAULT 0,
      done_count INTEGER NOT NULL DEFAULT 0,
      unresolved_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      added_count INTEGER NOT NULL DEFAULT 0,
      /* Set once, the first time a poll notices the job has outlived the 60s
         threshold, so three open tabs produce one notification rather than three. */
      notified_at TEXT,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_lead_import_jobs_active
      ON lead_import_jobs(organization_id, status);

    CREATE TABLE IF NOT EXISTS lead_import_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      job_id INTEGER NOT NULL REFERENCES lead_import_jobs(id) ON DELETE CASCADE,
      /* Position in the paste. The panel renders rows in this order and never
         re-sorts, so the list does not reflow while the user is watching it. */
      ordinal INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      maps_url TEXT NOT NULL,
      lat REAL,
      lng REAL,
      address TEXT,
      resolved_url TEXT,
      resolution TEXT NOT NULL DEFAULT 'unresolved'
        CHECK (resolution IN ('direct', 'pluscode', 'browser', 'nominatim', 'manual', 'unresolved')),
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'resolving', 'done', 'unresolved', 'duplicate', 'skipped')),
      duplicate_of TEXT CHECK (duplicate_of IN ('location', 'customer', 'batch')),
      duplicate_name TEXT,
      /* The saved_locations row this item became, so undo is a scoped delete that
         cannot reach anything the job did not create. */
      saved_location_id INTEGER REFERENCES saved_locations(id),
      UNIQUE (job_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS ix_lead_import_items_job
      ON lead_import_items(job_id, ordinal);
    CREATE INDEX IF NOT EXISTS ix_lead_import_items_saved
      ON lead_import_items(saved_location_id);

    /* Named, hand-ordered lists of prospect locations -- "امشب", "غرب تهران", whatever
       the user calls them. The automatic day-split proposes groupings; these are the
       answer to not liking what it proposed.

       In the database rather than in localStorage on purpose: a route being driven has
       to survive the phone restarting mid-round, and a list built on the laptop has to
       be there on the phone in the van. */
    CREATE TABLE IF NOT EXISTS lead_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    /* Membership is ordered, because the order *is* the route. ON DELETE CASCADE on both
       sides: a deleted list takes its membership with it, and a location removed from
       the prospect list stops appearing in every list that held it rather than becoming
       a row pointing at nothing. */
    CREATE TABLE IF NOT EXISTS lead_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES saved_locations(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (list_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_list_items_list ON lead_list_items(list_id, sort_order);

    CREATE TABLE IF NOT EXISTS facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'factory', 'van', 'home',
                                   'office', 'shop', 'cold_storage', 'parking', 'other')),
      name TEXT NOT NULL,
      /* The icon is the person's choice, not the kind's. It used to be derived from the
         kind, which meant a kind could only ever look like one thing, and adding a kind
         retroactively changed what every existing place of that kind looked like. NULL
         until chosen; the UI falls back to the kind's first option. */
      icon_key TEXT,
      address TEXT,
      /* Nullable, deliberately. Every place is made by a person through the app, so a
       * place can exist before anyone has dropped a pin: a warehouse you have not
       * located yet, a van nobody has parked, a home you have not entered. NOT NULL
       * here did not prevent those rows existing -- it only forced the writers to lie
       * about where they were, which is why a warehouse was auto-created at 0,0 and
       * every van was inserted at 0,0. A null location is a fact; 0,0 is a fiction in
       * the Gulf of Guinea. Readers must SKIP an unplaced facility, never substitute
       * a default for it. */
      lat REAL,
      lng REAL,
      maps_url TEXT,
      notes TEXT,
      is_default_origin INTEGER NOT NULL DEFAULT 0,
      owner_username TEXT,
      organization_id INTEGER REFERENCES organizations(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_facilities_kind ON facilities(kind);

    /* ---- The sales catalogue ------------------------------------------------------
       Company-wide, deliberately with no group_id. Two groups selling different
       products would be two businesses; the column would only ever be null, and a
       nullable scope column that is always null is an invitation to write a filter
       against it later and empty everyone's screen. */
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      base_unit TEXT NOT NULL DEFAULT 'عدد',
      /* عدد -> kg. Commission is paid per kilogram, so this factor is payroll input,
         which is why an order line freezes it rather than reading it back later. */
      kg_per_base_unit REAL NOT NULL DEFAULT 0,
      /* Moving average, maintained by purchase receipts. Whole Toman, like every money
         column added from here on -- see lib/money.ts for why the legacy REAL columns
         were left alone but must not spread. */
      avg_cost_toman INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    /* How the product is sold: «جعبه بچه (۱۲۰ عددی)», «کارتن ۲۴ تایی».

       qty_per_pack lives on the product/packaging pair rather than on the name, because
       the name is not unique across products in the real data: «جعبه بچه» is 120 عدد of
       one brand and 100 عدد of another, and both are rows in the workbook today. */
    CREATE TABLE IF NOT EXISTS packagings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty_per_pack REAL NOT NULL,
      barcode TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE (product_id, name)
    );

    /* Prices over time. Changing a price is an INSERT here; a row is never UPDATEd.
       That is what stops last month's revenue moving when this month's price is set --
       the failure mode of the single price cell this replaces. */
    CREATE TABLE IF NOT EXISTS product_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      /* Null means the price covers every packaging of the product -- the common case
         when a product is sold one way. */
      packaging_id INTEGER REFERENCES packagings(id) ON DELETE CASCADE,
      price_toman INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_product_prices_lookup
      ON product_prices(product_id, packaging_id, valid_from);
    CREATE INDEX IF NOT EXISTS idx_packagings_product ON packagings(product_id);

    /* What a unit actually cost, over time. Same shape and same reasoning as
       product_prices: a cost row is an INSERT, never an UPDATE.

       NO organization_id, and deliberately not in TENANT_TABLES either. A cost row
       reaches its tenant through products, exactly as product_prices and packagings
       do -- which is why all three sit on the exempt list in tests/tenancy-schema
       .test.ts with the reason "through products". Putting it in TENANT_TABLES instead
       would ALTER a column this table never declares and then stamp every row
       organization_id = 1: a SECOND answer to "whose cost is this" that can disagree
       with the product's own tenant. commission_tiers is not the precedent here -- it
       carries its own organization_id AND its own salesperson_user_id, so it really is
       independently tenant-scoped. This table has neither.

       No backticks anywhere in this comment: it lives inside a JS template literal, so
       one here closes the string and turns the rest of the sentence into a syntax error
       far from the cause.

       The method column is stored rather than inferred. 'weighted_average' is what purchase
       receipts maintain on products.avg_cost_toman and what a row here overrides;
       'landed' is a hand-entered figure including freight and duty. There is no 'fifo'
       or 'lifo': batches carry real expiry dates and are consumed FEFO, so a costing
       method keyed on purchase order would describe a system this one is not. */
    CREATE TABLE IF NOT EXISTS product_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      packaging_id INTEGER REFERENCES packagings(id) ON DELETE CASCADE,
      method TEXT NOT NULL CHECK (method IN ('weighted_average', 'landed')),
      cost_toman INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_product_costs_lookup
      ON product_costs(product_id, packaging_id, valid_from);

    /* ---- Ledger ---------------------------------------------------------------------
       accounts is GLOBAL on purpose: the chart is the business's structure, the postings
       are the tenant's. That is the product_costs argument (69a7e25) and the same one
       districts makes -- a chart of accounts that drifts per tenant is two charts that
       disagree. It is registered as exempt in tests/tenancy-schema.test.ts. */

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name_fa TEXT NOT NULL,
      name_en TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
      parent_id INTEGER REFERENCES accounts(id),
      is_postable INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0,1)),
      normal_balance TEXT NOT NULL CHECK (normal_balance IN ('DEBIT','CREDIT')),
      is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
    );

    CREATE TABLE IF NOT EXISTS fiscal_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      period_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      closed_at TEXT,
      closed_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE (organization_id, period_key)
    );

    CREATE TABLE IF NOT EXISTS journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      seq INTEGER NOT NULL,
      posted_at TEXT NOT NULL,
      period_key TEXT NOT NULL,
      memo TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN
        ('PAYMENT','CHEQUE','SALE','PURCHASE','SUPPLIER_PAYMENT','EXPENSE','OPENING','MANUAL','REVERSAL')),
      source_id INTEGER,
      reverses_journal_id INTEGER REFERENCES journals(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    /* Gapless per tenant: a tax office rejects holes, and the nextSeq read-then-write
       lives inside the posting transaction. */
    CREATE UNIQUE INDEX IF NOT EXISTS ux_journals_org_seq ON journals(organization_id, seq);
    CREATE INDEX IF NOT EXISTS ix_journals_org_period ON journals(organization_id, period_key, id);

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      journal_id INTEGER NOT NULL REFERENCES journals(id),
      account_id INTEGER NOT NULL REFERENCES accounts(id),
      side TEXT NOT NULL CHECK (side IN ('D','C')),
      amount_toman INTEGER NOT NULL CHECK (amount_toman > 0),
      customer_id INTEGER REFERENCES customers(id),
      supplier_id INTEGER,
      memo TEXT,
      created_at TEXT NOT NULL
    );
    /* ix_ledger_entries_account is on (account_id, id), NOT (account_id, posted_at):
       posted_at lives on journals and is not a column here, and an index naming a
       missing column fails the whole exec. The account statement joins journals. */
    CREATE INDEX IF NOT EXISTS ix_ledger_entries_journal ON ledger_entries(journal_id);
    CREATE INDEX IF NOT EXISTS ix_ledger_entries_account ON ledger_entries(account_id, id);
    CREATE INDEX IF NOT EXISTS ix_ledger_entries_customer ON ledger_entries(customer_id, id);
    CREATE INDEX IF NOT EXISTS ix_ledger_entries_supplier ON ledger_entries(supplier_id, id);

    /* Tenant-scoped, unlike accounts: a supplier is ONE business's relationship, not a
       shared taxonomy. That is the same distinction the chart decision draws, and the
       commission_rates comment reaches the same conclusion for the same reason. */
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    /* Unique on the RAW name, not TRIM(name). The migration folds legacy free text in with
       TRIM, so "  ACME  " and "ACME" would otherwise collapse into one supplier and two
       different vendors become one payable balance. Uniqueness is per tenant, because two
       organisations may legitimately buy from a supplier of the same name. */
    CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_org_name ON suppliers(organization_id, name);

    /* Append-only, enforced by the DATABASE and not by convention. IF NOT EXISTS is
       mandatory: these re-run on every boot and a bare CREATE TRIGGER throws. The pattern
       is lib/repo/crm/migrate.ts's -- and payments has no trigger at all, so this is the
       first thing in the money path to have one. No role can edit posted history; a
       mistake is corrected by a REVERSAL journal that points at the original. */
    CREATE TRIGGER IF NOT EXISTS journals_no_update BEFORE UPDATE ON journals
      BEGIN SELECT RAISE(ABORT, 'journals is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS journals_no_delete BEFORE DELETE ON journals
      BEGIN SELECT RAISE(ABORT, 'journals is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update BEFORE UPDATE ON ledger_entries
      BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete BEFORE DELETE ON ledger_entries
      BEGIN SELECT RAISE(ABORT, 'ledger_entries is append-only'); END;
    /* An account a posted leg depends on is part of the history too. Deactivating is how
       an account retires; deleting it would silently orphan every leg that used it. */
    CREATE TRIGGER IF NOT EXISTS accounts_no_delete BEFORE DELETE ON accounts
      BEGIN
        SELECT RAISE(ABORT, 'accounts is append-only: deactivate an account, do not delete it');
      END;

    /* ---- Orders ------------------------------------------------------------------
       The table that replaces the paper. Sales were never recorded in the workbook --
       they were written on slips -- so there is nothing to migrate into this and no
       dual-running period, which is why it is worth building now rather than later.

       group_id is stamped from the customer when the order is created rather than
       joined at read time, the same pattern saved_locations and lead_lists use. A
       customer moving territory must not move last month's orders with it: the order
       belongs to whoever's territory it was sold in. */
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      /* Allocated by the server inside the insert transaction. Hand-typed numbers
         collide the moment two people record at once. Latin digits -- see
         formatOrderNo in lib/orderMath.ts. */
      order_no TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      group_id INTEGER REFERENCES groups(id),
      /* Who the order is credited to for commission. Not necessarily who typed it:
         today the manager records what the cold-call فروشنده sold. */
      salesperson_user_id INTEGER REFERENCES users(id),
      /* Phase 3 widens this to the 12-state machine (rebuildOrdersStatusMachine, run in
         the migration section); the base table keeps the pre-Phase-3 CHECK so a
         pre-tenancy DB's rebuildForTenantUnique copy still validates before the value
         map runs. lib/orderStateMachine.ts is the source of truth for legal moves. */
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'delivered', 'cancelled')),
      order_date TEXT NOT NULL,
      delivered_at TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
      paid_toman INTEGER NOT NULL DEFAULT 0,
      /* Non-null means the order was taken past the customer's credit limit, and by
         whom. The limit warns rather than blocks, so this is the record of the
         override -- a warning nobody can be shown to have ignored is not a control. */
      credit_override_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, order_date);
    CREATE INDEX IF NOT EXISTS idx_orders_scope ON orders(group_id, status, order_date);
    CREATE INDEX IF NOT EXISTS idx_orders_salesperson ON orders(salesperson_user_id, order_date);

    /* The snapshot columns below are written once and never recomputed. That is the
       whole mechanism: product_prices answers "what do we charge now", and these answer
       "what did this order actually cost", and only having both makes a retroactive
       correction a deliberate, visible act instead of an invisible side effect.

       qty_per_pack and kg_per_base_unit are frozen here rather than joined for the same
       reason: a box revised from 120 to 100 عدد must not change what an old order
       weighed, because commission was already paid on the original figure. */
    CREATE TABLE IF NOT EXISTS order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      packaging_id INTEGER NOT NULL REFERENCES packagings(id),
      packs_ordered REAL NOT NULL,
      /* Null until the driver confirms. Zero is a real answer -- the customer refused
         the line at the door -- and is not the same thing as null. */
      packs_delivered REAL,
      unit_price_toman INTEGER NOT NULL,
      unit_cost_toman INTEGER NOT NULL DEFAULT 0,
      qty_per_pack REAL NOT NULL,
      kg_per_base_unit REAL NOT NULL,
      /* Which price row this was read from, so "why was it charged that?" has an answer
         rather than an inference. */
      price_id INTEGER REFERENCES product_prices(id),
      is_reversal INTEGER NOT NULL DEFAULT 0,
      reverses_line_id INTEGER REFERENCES order_lines(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_lines_product ON order_lines(product_id);

    /* Phase 3: pick-lists for why a delivery failed / was late, why an order was
       cancelled / returned. organization_id NULL = a system default every tenant sees;
       a tenant may add its own. Seeded by seedReasonCodes(). */
    CREATE TABLE IF NOT EXISTS reason_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      domain TEXT NOT NULL CHECK (domain IN
        ('delivery_fail', 'delivery_delay', 'order_cancel', 'order_return')),
      code TEXT NOT NULL,
      label_fa TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE (organization_id, domain, code)
    );

    /* Phase 3: the audit trail for the order machine. Append-only -- one row per
       transition, plus a synthetic 'create' row (from_status NULL) per order. A child
       of orders for tenancy (it reaches its org through order_id), but carries
       organization_id so a "what happened today" query need not join. device_time is
       the client's own clock, kept beside the server's authoritative created_at so a
       divergence is visible rather than silently trusted. */
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      from_status TEXT,
      to_status TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_user_id INTEGER REFERENCES users(id),
      reason_code_id INTEGER REFERENCES reason_codes(id),
      note TEXT,
      device_time TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, id);

    /* ---- Delivery ----------------------------------------------------------------
       A run is one driver's day. UNIQUE on (driver, date) because two runs for the
       same driver on the same day is always a mistake, and the mistake is expensive:
       half the stops end up on a run nobody opens. */
    CREATE TABLE IF NOT EXISTS delivery_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_user_id INTEGER NOT NULL REFERENCES users(id),
      group_id INTEGER REFERENCES groups(id),
      run_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'done')),
      started_at TEXT,
      finished_at TEXT,
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      /* Phase 2: which kind of day this is. 'mixed' means it carries BOTH delivery stops
         (delivery_stops) and visit stops (lead_run_stops) — the state a driver who delivers
         and visits in one loop actually produces, and the reason the two tables were folded.
         Stated here rather than only in a migration so a FRESH database has it too; the
         default is correct for every row that is not a fold. */
      kind TEXT NOT NULL DEFAULT 'delivery_only'
        CHECK (kind IN ('delivery_only', 'mixed')),
      UNIQUE (driver_user_id, run_date)
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_runs_driver ON delivery_runs(driver_user_id, run_date);

    /* A lead run is a delivery run with a pin at each stop, and it is modelled on the table above
       deliberately. That is why it is no longer its own table: Phase 2 folds lead_runs into
       delivery_runs, and delivery_runs.kind ('delivery_only' | 'mixed') records which it
       is. Two tables for one idea meant two UNIQUE(driver_user_id, run_date) constraints that
       never spoke to each other, so one driver could hold a delivery run AND a lead run on the
       same date and each page would show only its own half of that day.

       The stops are still pins, not orders: a stop is a place to drive to, and what happened
       there is already recorded against the pin itself (saved_locations.visit_outcome) by the
       visit. Re-deriving it here would be a second copy of the truth to keep in step.

       There is deliberately NO CREATE TABLE for lead_runs any more — a fresh database must not
       build the table it is about to retire. foldLeadRunsIntoDeliveryRuns drops it from any
       database that still has one, and the stops below hang off delivery_runs directly.

       No backticks above: this block is inside a db.exec template literal, so one would end
       the string and the parser would read the rest of this comment as code. */

    CREATE TABLE IF NOT EXISTS lead_run_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES saved_locations(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (run_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_run_stops_run ON lead_run_stops(run_id, sort_order);

    /* One stop is one order at one door. The stop carries what happened there; the
       order's own lines carry what was actually handed over. */
    CREATE TABLE IF NOT EXISTS delivery_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'delivered', 'refused', 'skipped')),
      collected_toman INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      delivered_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (run_id, order_id)
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_stops_run ON delivery_stops(run_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_delivery_stops_order ON delivery_stops(order_id);

    /* A route can also START and END at a building.
     *
     * These are their own tables rather than extra rows in delivery_stops, and the reason is
     * a SQLite trap: delivery_stops.order_id is NOT NULL and carries
     * UNIQUE (run_id, order_id), which is what stops one order appearing twice on a run. Make
     * order_id nullable to squeeze a facility in and that guard silently stops working --
     * SQLite treats NULLs as DISTINCT from each other, so two rows with a NULL order_id
     * sail past the constraint. No error, no warning, just a duplicated stop. So a facility
     * visit, which is not a delivery, does not go in the deliveries table.
     *
     * NEITHER table carries organization_id. Both are reached through delivery_runs, which is
     * in TENANT_TABLES, so the tenant sweep already stamps them. The same reasoning as
     * lead_run_stops, and for the same reason: a redundant scope column is an invitation to
     * write a filter against the wrong one.
     *
     * role 'load' is always the FIRST stop of the day and 'unload' has no position at all --
     * the driver decides when to do it. A single table with a nullable sort_order would let
     * both look sequenced, and then renumbering the whole day by dragging an "unordered" stop
     * would be possible, which is the lie this design exists to prevent. */
    CREATE TABLE IF NOT EXISTS run_facility_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
      facility_id INTEGER NOT NULL REFERENCES facilities(id),
      role TEXT NOT NULL CHECK (role IN ('load', 'unload')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
      done_at TEXT,
      done_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      /* One load and one unload per run. Not an accident of the schema: a second unload
         destination is a decision the manager has not been asked to make yet, and a second
         load is a data-entry mistake. */
      UNIQUE (run_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_run_facility_stops_run ON run_facility_stops(run_id, role);

    /* What actually came back, per product, and where it went.
     *
     * A RECONCILIATION, not a number: the app knows what went out and what got delivered, so
     * it pre-fills every line and the driver confirms or corrects. More than one line per
     * unload is the normal case -- «خراب ۵ کیلو» beside «تاریخ مصرف گذشته ۲ کارتن» -- so this
     * is one row per product per disposition.
     *
     * damaged and expired are SEPARATE values that write the same WRITE_OFF movement, because
     * "we broke it" and "the supplier sent it expired" are different problems and a manager
     * watching the rates needs to tell them apart. */
    CREATE TABLE IF NOT EXISTS run_unload_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES delivery_runs(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      disposition TEXT NOT NULL CHECK (disposition IN
        ('returned', 'damaged', 'expired', 'discarded', 'lost', 'sample')),
      qty_base INTEGER NOT NULL,
      note TEXT,
      occurred_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_unload_lines_run ON run_unload_lines(run_id);

    /* A PROPOSED day — the thing you drag orders into before it is real.
     *
     * This is the whole page's design in one table. A lane missing either a driver or a date
     * is a DRAFT: it exists on your board and nowhere else, and it becomes a run when you
     * press «سفر را قطعی کن» on that one lane. There is no global commit button, so there is
     * nothing to forget and nowhere to navigate back to.
     *
     * It carries organization_id AND user_id, unlike run_facility_stops. A draft belongs to a
     * RUN, which belongs to a company; a draft belongs to a PERSON first. Two managers in
     * the same company must not see each other's half-formed plans -- that is the entire
     * privacy promise, and it cannot be made by a query against a table that only knows the
     * company.
     *
     * created_by_suggest + manual_edits are what make «پیشنهاد بده» decidable: a lane is
     * empty iff the suggestion made it AND nobody has touched it. The first hand-drag sets
     * manual_edits and NOTHING clears it, so the arrangement a person built is never silently
     * overwritten by the next press of a button.
     *
     * driver_user_id and run_date are NULLABLE ON PURPOSE. A NOT NULL pair would mean a
     * draft is already half a run, which is precisely what it is not. */
    CREATE TABLE IF NOT EXISTS run_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      driver_user_id INTEGER REFERENCES users(id),
      run_date TEXT,
      created_by_suggest INTEGER NOT NULL DEFAULT 0,
      manual_edits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_drafts_user ON run_drafts(organization_id, user_id);

    CREATE TABLE IF NOT EXISTS run_draft_stops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id INTEGER NOT NULL REFERENCES run_drafts(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      seq INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      /* An order may be dragged into at most one lane on one board. Mirrors
       * delivery_stops' own guard, for the same reason. */
      UNIQUE (draft_id, order_id)
    );
    CREATE INDEX IF NOT EXISTS idx_run_draft_stops_draft ON run_draft_stops(draft_id, seq);

    /* Phase 3 (M6): delivery as its own entity, between the order and the route stop.
       One stop may carry several deliveries (two orders for one customer, one visit);
       one order may have several deliveries (a retry after a failed attempt is seq 2).
       actual_arrival and completed_at are SERVER timestamps, set on receipt -- the
       device's own clock goes to device_time so a divergence is visible, not trusted. */
    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      order_id INTEGER NOT NULL REFERENCES orders(id),
      seq INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN
        ('PLANNED', 'ASSIGNED', 'LOADED', 'IN_TRANSIT', 'DELIVERED', 'PARTIAL',
         'FAILED', 'RETURNED', 'CANCELLED')),
      route_stop_id INTEGER REFERENCES delivery_stops(id),
      planned_date TEXT,
      planned_arrival TEXT,
      actual_arrival TEXT,
      completed_at TEXT,
      fail_reason_id INTEGER REFERENCES reason_codes(id),
      delay_reason_id INTEGER REFERENCES reason_codes(id),
      receiver_name TEXT,
      signature_path TEXT,
      photo_path TEXT,
      gps_lat REAL,
      gps_lng REAL,
      collected_toman INTEGER NOT NULL DEFAULT 0,
      payment_id INTEGER REFERENCES payments(id),
      device_time TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (order_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_order ON deliveries(order_id, seq);
    CREATE INDEX IF NOT EXISTS idx_deliveries_stop ON deliveries(route_stop_id);

    /* What was planned vs. what was actually handed over / brought back, per order line.
       Child of deliveries for tenancy. */
    CREATE TABLE IF NOT EXISTS delivery_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
      order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
      qty_planned REAL NOT NULL DEFAULT 0,
      qty_delivered REAL NOT NULL DEFAULT 0,
      qty_returned REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_delivery_lines_delivery ON delivery_lines(delivery_id);

    /* ---- Commission ---------------------------------------------------------------
       Paid per kilogram of goods delivered. Effective-dated and INSERT-only, like
       product_prices and for the same reason: a rate held in one cell means raising it
       today silently restates what everyone earned last month.

       salesperson_user_id NULL is the company-wide default that applies to anyone
       without a rate of their own -- so onboarding a فروشنده does not require setting a
       rate before their first order can accrue anything. */
    CREATE TABLE IF NOT EXISTS commission_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_user_id INTEGER REFERENCES users(id),
      rate_per_kg_toman INTEGER NOT NULL,
      /* For فوری deliveries. Null means the ordinary rate applies to those too. */
      urgent_rate_per_kg_toman INTEGER,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commission_rates_lookup
      ON commission_rates(salesperson_user_id, valid_from);

    /* A tiered plan for one salesperson, effective-dated like every other rate in this file.
     *
     *  Kept SEPARATE from commission_rates rather than added as columns to it. A flat rate
     *  is exactly a marginal plan with one tier, so the two share an implementation -- but
     *  they do not share a row shape: a flat rate is one number, a plan is an ordered set
     *  with bounds and a mode. Putting tiers in the same table would mean nullable bound
     *  columns that are meaningless for every existing row.
     *
     *  mode is stored rather than inferred, because 'marginal' and 'accelerator' differ
     *  only in how the tiers are applied and an inference would have to guess. 'cliff' is
     *  stored for the same reason: it is the one mode that can pay LESS for delivering more,
     *  and that has to be an explicit, recorded decision.
     *
     *  valid_from mirrors commission_rates so a backdated plan restates unpaid accruals and
     *  never a recorded payment -- the asymmetry lib/commission.ts already documents.
     *
     *  organization_id is in the CREATE and not left to the TENANT_TABLES sweep: this table
     *  is new, so there is no existing database to backfill, and a plan that cannot say which
     *  company it belongs to is a cross-tenant leak waiting for the first query. Same
     *  reasoning as lead_runs. */
    CREATE TABLE IF NOT EXISTS commission_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_user_id INTEGER REFERENCES users(id),
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      mode TEXT NOT NULL DEFAULT 'marginal'
        CHECK (mode IN ('marginal', 'accelerator', 'cliff')),
      metric TEXT NOT NULL DEFAULT 'kg'
        CHECK (metric IN ('kg', 'volume_m3', 'revenue_toman', 'margin_toman', 'orders')),
      from_value REAL NOT NULL,
      to_value REAL,
      rate_type TEXT NOT NULL CHECK (rate_type IN ('flat', 'pct')),
      rate_value REAL NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commission_tiers_lookup
      ON commission_tiers(salesperson_user_id, valid_from);
    CREATE INDEX IF NOT EXISTS idx_commission_tiers_org
      ON commission_tiers(organization_id, valid_from);

    /* Money that actually moved. Accrual is derived from delivered weight and the rate
       in force, and can therefore be restated by a backdated rate; a payment cannot,
       and that asymmetry is deliberate -- one is a calculation, the other is a fact.

       NOT NULL on the person: a payment with nobody attached is money leaving with no
       statement to reconcile it against. */
    CREATE TABLE IF NOT EXISTS commission_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesperson_user_id INTEGER NOT NULL REFERENCES users(id),
      amount_toman INTEGER NOT NULL,
      paid_on TEXT NOT NULL,
      period_from TEXT,
      period_to TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commission_payments_person
      ON commission_payments(salesperson_user_id, paid_on);

    /* ---- Commission, راننده -------------------------------------------------------
       A driver earns on what they PERSONALLY handed over, not on what was ordered --
       the same delivered-not-ordered rule سفارش commission follows, just measured
       against delivery_stops instead of orders.salesperson_user_id. A separate table
       rather than reusing commission_rates: the two are both "toman per kilogram", but
       a rate row that could belong to either a فروشنده or a راننده would need a second
       column just to say which, and every reader would have to filter on it -- two
       small tables are simpler than one table with a discriminator nobody can forget
       to check. */
    CREATE TABLE IF NOT EXISTS driver_commission_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_user_id INTEGER REFERENCES users(id),
      rate_per_kg_toman INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_driver_commission_rates_lookup
      ON driver_commission_rates(driver_user_id, valid_from);

    CREATE TABLE IF NOT EXISTS driver_commission_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      driver_user_id INTEGER NOT NULL REFERENCES users(id),
      amount_toman INTEGER NOT NULL,
      paid_on TEXT NOT NULL,
      period_from TEXT,
      period_to TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_driver_commission_payments_person
      ON driver_commission_payments(driver_user_id, paid_on);

    /* ---- Commission, مدیر گروه -----------------------------------------------------
       Not a per-kilogram rate at all -- a مدیر گروه does not deliver or sell a kilogram
       themself, they run the people who do. Their incentive is a share of what their
       whole group accrued, so the number here is a percentage, resolved the same
       effective-dated way every other rate in this file is, and applied to the group's
       total from commissionLedger.allStatements rather than to any order of their own. */
    CREATE TABLE IF NOT EXISTS manager_commission_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manager_user_id INTEGER REFERENCES users(id),
      override_pct REAL NOT NULL,
      valid_from TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manager_overrides_lookup
      ON manager_commission_overrides(manager_user_id, valid_from);

    CREATE TABLE IF NOT EXISTS manager_commission_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      manager_user_id INTEGER NOT NULL REFERENCES users(id),
      amount_toman INTEGER NOT NULL,
      paid_on TEXT NOT NULL,
      period_from TEXT,
      period_to TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manager_commission_payments_person
      ON manager_commission_payments(manager_user_id, paid_on);

    /* ---- Purchases and stock ------------------------------------------------------
       A receipt of goods into the warehouse. Replaces the خرید sheet.

       Company-wide, with no group_id, for the same reason the catalogue has none: one
       warehouse serves every group, and a scope column that is always null invites a
       filter that empties everyone's screen. */
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier TEXT,
      purchase_date TEXT NOT NULL,
      invoice_no TEXT,
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);

    /* Quantities are in the product's base unit (عدد), not in packs: a supplier's
       carton is rarely the carton we sell, and converting once on the way in is far
       less error-prone than carrying two pack sizes through every stock query. */
    CREATE TABLE IF NOT EXISTS purchase_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      base_qty REAL NOT NULL,
      unit_cost_toman INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase ON purchase_lines(purchase_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_lines_product ON purchase_lines(product_id);

    /* Phase 1 (Money). One row per sum of money received. Append-only: a mistake is
       voided_at + a fresh row, never an edit, so the ledger cannot be rewritten. The
       amount is settled against orders through payment_allocations; anything left over
       sits on the customer's account as an allocation with order_id NULL. */
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      amount_toman INTEGER NOT NULL,
      method TEXT NOT NULL CHECK (method IN
        ('CASH', 'POS', 'CARD_TO_CARD', 'CHEQUE', 'CREDIT_NOTE', 'OTHER')),
      received_at TEXT NOT NULL,
      received_by INTEGER NOT NULL REFERENCES users(id),
      reference TEXT,
      receipt_photo_stem TEXT,
      /* Set iff method = 'CHEQUE'. No FK: the cheques table is created by a later
         migration and SQLite cannot add the constraint afterwards -- the link is
         enforced in lib/repo/cheques.ts. */
      cheque_id INTEGER,
      /* Set when the payment is the cash a driver collected at a delivery stop. It makes
         recordDelivery idempotent: a retried sync finds the existing row for the stop
         instead of stacking a second one. */
      delivery_stop_id INTEGER REFERENCES delivery_stops(id),
      note TEXT,
      voided_at TEXT,
      voided_by INTEGER REFERENCES users(id),
      void_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_payments_customer ON payments(organization_id, customer_id, received_at);
    CREATE INDEX IF NOT EXISTS ix_payments_stop ON payments(delivery_stop_id);

    /* Reaches a tenant through payments, so it carries no organization_id of its own
       and is on the exempt list in tests/tenancy-schema.test.ts. order_id NULL means
       the slice is on account (an unallocated credit). */
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id),
      amount_toman INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_alloc_order ON payment_allocations(order_id);

    /* Phase 1 (Money). An Iranian customer cheque and its whole journey, as a state
       machine (lib/chequeStates.ts) rather than a free status field. The normal entry
       point is 'in_hand'; 'issued' is a stub for a cheque we write (supplier payments,
       later). A 'bounced' transition reverses the linked payment's allocations -- the
       debt it had settled comes back -- and raises a reminder. */
    CREATE TABLE IF NOT EXISTS cheques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      amount_toman INTEGER NOT NULL,
      cheque_no TEXT NOT NULL,
      bank_name TEXT,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_hand' CHECK (status IN
        ('issued', 'in_hand', 'deposited', 'cleared', 'bounced', 'replaced', 'cancelled')),
      received_at TEXT NOT NULL,
      received_by INTEGER NOT NULL REFERENCES users(id),
      deposited_at TEXT,
      cleared_at TEXT,
      bounced_at TEXT,
      replaced_by_cheque_id INTEGER REFERENCES cheques(id),
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, customer_id, cheque_no)
    );
    CREATE INDEX IF NOT EXISTS ix_cheques_status ON cheques(organization_id, status, due_date);

    /* Phase 2 (Stock & Batches). A received physical lot: code, supplier ref, expiry,
       quantity, and a small status machine (lib/batchStates.ts). Cost stays
       moving-average on the product -- unit_cost_toman here is carried for trace and
       per-batch valuation, not for FIFO costing. expired/depleted are written by a
       sweep, not the API. */
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_code TEXT NOT NULL,
      supplier_batch_ref TEXT,
      purchase_line_id INTEGER REFERENCES purchase_lines(id),
      produced_at TEXT,
      expiry_date TEXT,
      qty_received_base REAL NOT NULL,
      unit_cost_toman INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN
        ('active', 'quarantined', 'recalled', 'expired', 'depleted')),
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, product_id, batch_code)
    );
    CREATE INDEX IF NOT EXISTS ix_batches_product ON batches(organization_id, product_id, expiry_date);

    /* Signed, append-only stock ledger. On-hand is SUM(base_qty) over this table --
       still derived, never a stored counter, but now per batch and per facility. A
       mistake is a compensating ADJUSTMENT / WRITE_OFF, never an edit. base_qty may
       drive on-hand negative (the books lag reality while paper drains -- the UI flags
       it, same rule as lib/stockMath). batch_id NULL = an unbatched line (an oversell
       shortfall, or legacy data). */
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      facility_id INTEGER NOT NULL REFERENCES facilities(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_id INTEGER REFERENCES batches(id),
      base_qty REAL NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN
        ('PURCHASE_IN', 'TRANSFER_OUT', 'TRANSFER_IN', 'DELIVERY_OUT', 'SAMPLE_OUT',
         'RETURN_IN', 'ADJUSTMENT', 'COUNT', 'WRITE_OFF')),
      ref_type TEXT,
      ref_id INTEGER,
      occurred_at TEXT NOT NULL,
      created_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_stock_mv ON stock_movements
      (organization_id, product_id, batch_id, facility_id, occurred_at);

    /* Phase 3: a confirmed order CLAIMS stock without moving it. on_hand stays
       SUM(stock_movements.base_qty); "available to promise" is on_hand minus the sum of
       un-released reservations. A reservation is released when the order is cancelled or
       a failed delivery sends it back, and consumed (also released -- the DELIVERY_OUT
       movement is then the real record) when the goods actually leave. batch_id NULL is
       a shortfall reservation: still recorded so negative availability shows. */
    CREATE TABLE IF NOT EXISTS stock_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      batch_id INTEGER REFERENCES batches(id),
      base_qty REAL NOT NULL,
      released_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_stock_res_order ON stock_reservations(order_id);
    CREATE INDEX IF NOT EXISTS ix_stock_res_open ON stock_reservations(product_id, batch_id)
      WHERE released_at IS NULL;

    /* Which batch actually went out on which delivery line -- the forward-traceability
       spine. Keyed to delivery_stop_id because the deliveries table is Phase 3 (M6);
       a comment there marks the rename. */
    CREATE TABLE IF NOT EXISTS delivery_line_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      delivery_stop_id INTEGER NOT NULL REFERENCES delivery_stops(id),
      order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
      batch_id INTEGER REFERENCES batches(id),
      base_qty REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_dlb_batch ON delivery_line_batches(batch_id);
    CREATE INDEX IF NOT EXISTS ix_dlb_stop ON delivery_line_batches(delivery_stop_id);

    /* A quality complaint tied to a customer, order, product and batch. Clustering on a
       batch raises an alert -- but software does not replace a QA specialist for safety
       calls (source-extract), so this is a signal, not a verdict. */
    CREATE TABLE IF NOT EXISTS quality_complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER REFERENCES customers(id),
      order_id INTEGER REFERENCES orders(id),
      product_id INTEGER REFERENCES products(id),
      batch_id INTEGER REFERENCES batches(id),
      reported_at TEXT NOT NULL,
      reported_by INTEGER REFERENCES users(id),
      category TEXT NOT NULL CHECK (category IN
        ('spoilage', 'packaging', 'foreign_object', 'short_weight', 'wrong_product', 'other')),
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      description TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN
        ('open', 'investigating', 'resolved', 'dismissed')),
      resolution TEXT,
      resolved_at TEXT,
      resolved_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_complaints_batch ON quality_complaints(organization_id, batch_id, reported_at);

    /* Phase 4 (Offline-first): the server's idempotency log. A mutation is upserted on
       (organization_id, client_uuid) -- replaying it returns the stored result rather
       than applying twice. occurred_at is the device clock (the only witness for a
       basement delivery synced hours later); received_at is the server's; clock_skew_ms
       is measured each sync so a wrong device clock is detectable. */
    CREATE TABLE IF NOT EXISTS sync_mutations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      client_uuid TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      device_id TEXT,
      op TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      clock_skew_ms INTEGER NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL,
      applied_at TEXT,
      status TEXT NOT NULL DEFAULT 'received' CHECK (status IN
        ('received', 'applied', 'duplicate', 'conflict', 'failed')),
      result_json TEXT,
      error TEXT,
      UNIQUE (organization_id, client_uuid)
    );
    CREATE INDEX IF NOT EXISTS ix_sync_mutations_recent ON sync_mutations(organization_id, received_at);

    /* Tombstones. Without these a delete never propagates to a device that pulled the
       row before it went away. */
    CREATE TABLE IF NOT EXISTS deleted_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      deleted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_deleted_rows_since ON deleted_rows(organization_id, deleted_at);

    /* Phase 5 (Routing / M7): the fleet. has_refrigeration is a hard skill -- above 30 C
       (Phase 6) an unrefrigerated van has a maximum time before quality is at risk, so
       the router treats a refrigerated vehicle as a required skill on hot days. */
    CREATE TABLE IF NOT EXISTS vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      plate TEXT,
      name TEXT NOT NULL,
      driver_default_id INTEGER REFERENCES users(id),
      max_weight_kg REAL,
      max_volume_m3 REAL,
      max_stops INTEGER,
      has_refrigeration INTEGER NOT NULL DEFAULT 0,
      cost_per_km_toman INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, plate)
    );

    /* A recurring delivery route: a territory, a default driver+vehicle, capacity ceilings
       and a per-stop service time the planner uses to estimate duration. */
    CREATE TABLE IF NOT EXISTS route_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      territory_id INTEGER REFERENCES districts(id),
      default_driver_id INTEGER REFERENCES users(id),
      default_vehicle_id INTEGER REFERENCES vehicles(id),
      max_stops INTEGER,
      max_weight_kg REAL,
      max_volume_m3 REAL,
      max_duration_min INTEGER,
      service_time_min INTEGER NOT NULL DEFAULT 8,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, code)
    );

    /* Phase 6 (Weather): one forecast row per ~1 km cell per day. NOT tenant data -- a
       forecast for a lat/lng is the same for every company. */
    CREATE TABLE IF NOT EXISTS weather_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat_r REAL NOT NULL,
      lng_r REAL NOT NULL,
      forecast_date TEXT NOT NULL,
      temp_min REAL, temp_max REAL,
      precip_prob INTEGER, precip_mm REAL, snow_mm REAL,
      wind_kmh REAL, gust_kmh REAL,
      visibility_m INTEGER, weather_code INTEGER,
      fetched_at TEXT NOT NULL,
      raw_json TEXT,
      UNIQUE (lat_r, lng_r, forecast_date)
    );

    /* The measured effect of each weather condition on route capacity. organization_id
       NULL = the shipped defaults (seedCapacityFactors); a tenant may tune its own.
       Phase 10 replaces the constants with values regressed from a season of actuals. */
    CREATE TABLE IF NOT EXISTS capacity_factors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      condition_code TEXT NOT NULL,
      stop_factor REAL NOT NULL DEFAULT 1,
      service_time_factor REAL NOT NULL DEFAULT 1,
      speed_factor REAL NOT NULL DEFAULT 1,
      max_duration_factor REAL NOT NULL DEFAULT 1,
      note_fa TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, condition_code)
    );

    /* Phase 7 (M8): the event / task / alert / rule spine. The events table is the
       generic append-only fact bus; order_events stays as the order-specific audit. */
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      /* No FK on any reference: an append-only bus must outlive the rows it mentions,
         and deleting a user or an order must not cascade-break the history. */
      organization_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      entity_type TEXT, entity_id INTEGER,
      actor_user_id INTEGER,
      metadata_json TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_events_recent ON events(organization_id, kind, occurred_at);

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      assignee_user_id INTEGER REFERENCES users(id),
      role_hint TEXT,
      group_id INTEGER REFERENCES groups(id),
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      entity_type TEXT, entity_id INTEGER,
      due_at TEXT,
      priority TEXT NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
      outcome_code TEXT,
      outcome_note TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      done_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_tasks_open ON tasks(organization_id, assignee_user_id, status, due_at);

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'opportunity')),
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      entity_type TEXT, entity_id INTEGER,
      group_id INTEGER REFERENCES groups(id),
      created_at TEXT NOT NULL,
      resolved_at TEXT, resolved_by INTEGER REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS ix_alerts_open ON alerts(organization_id, severity, resolved_at);

    /* A rule: an event.kind (or 'sweep') + a flat condition list -> a task, an alert, or
       a notification fan-out ('notify', Phase 1 notification system). A cooldown so it
       does not spam and an optional escalation. organization_id NULL = a shipped default
       (seedRules). */
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      trigger_kind TEXT NOT NULL,
      condition_json TEXT,
      action_kind TEXT NOT NULL CHECK (action_kind IN ('task', 'alert', 'notify')),
      action_json TEXT,
      cooldown_min INTEGER NOT NULL DEFAULT 1440,
      escalate_after_min INTEGER,
      escalate_to_role TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, code)
    );

    CREATE TABLE IF NOT EXISTS rule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      rule_id INTEGER NOT NULL REFERENCES rules(id),
      entity_type TEXT, entity_id INTEGER,
      fired_at TEXT NOT NULL,
      cooldown_until TEXT NOT NULL,
      task_id INTEGER REFERENCES tasks(id),
      alert_id INTEGER REFERENCES alerts(id),
      escalated_at TEXT,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_rule_runs_live ON rule_runs(organization_id, rule_id, entity_id, resolved_at);

    -- Notification system (Phase 1). notification_types is the catalogue, seeded with
    -- organization_id NULL defaults exactly like rules; a tenant row with the same
    -- code overrides. notifications is one row per (recipient, event) and is the feed
    -- plus the system of record.
    CREATE TABLE IF NOT EXISTS notification_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      code TEXT NOT NULL,
      name_fa TEXT NOT NULL,
      category TEXT NOT NULL,
      directedness TEXT NOT NULL CHECK (directedness IN ('directed', 'ambient')),
      priority TEXT NOT NULL CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
      group_scope TEXT NOT NULL CHECK (group_scope IN ('entity', 'type_day')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, code)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      type_code TEXT NOT NULL,
      title_fa TEXT NOT NULL,
      body_fa TEXT,
      entity_type TEXT,
      entity_id INTEGER,
      group_key TEXT NOT NULL,
      priority TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT,
      read_at TEXT,
      source_event_id INTEGER,
      source_rule_run_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_notifications_feed ON notifications(organization_id, user_id, read_at, created_at);
    CREATE INDEX IF NOT EXISTS ix_notifications_group ON notifications(user_id, group_key);

    -- Notification system (Phase 2, loud channels). Per-user, not org-scoped: user_id
    -- resolves to an organisation transitively, so these hold no NULL-org shared rows and
    -- stay out of TENANT_TABLES. notification_prefs is the per-(user,type,channel) override
    -- of the catalogue's default_push / default_telegram; notification_channels is the
    -- per-(user,channel) master switch + quiet-hours window; notification_deliveries is the
    -- append-only log of what was flushed to push / telegram.
    CREATE TABLE IF NOT EXISTS notification_prefs (
      user_id INTEGER NOT NULL,
      type_code TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('push', 'telegram')),
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, type_code, channel)
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      user_id INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('push', 'telegram')),
      enabled INTEGER NOT NULL DEFAULT 1,
      quiet_start TEXT,
      quiet_end TEXT,
      critical_breaks_quiet INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, channel)
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('push', 'telegram')),
      flushed_at TEXT NOT NULL,
      notification_ids_json TEXT NOT NULL,
      provider_ref TEXT,
      target TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_notification_deliveries ON notification_deliveries(user_id, channel, flushed_at);

    CREATE TABLE IF NOT EXISTS targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      user_id INTEGER REFERENCES users(id),
      group_id INTEGER REFERENCES groups(id),
      period TEXT NOT NULL,
      metric TEXT NOT NULL CHECK (metric IN ('revenue_toman', 'kg', 'orders')),
      target_value REAL NOT NULL,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      UNIQUE (organization_id, user_id, group_id, period, metric)
    );

    /* Board & Pocket: a template that spawns a task on a schedule. The sweep
       (spawnRecurringTasks in lib/repo/rules.ts, run from /api/rules/run) inserts a
       tasks row when rrule matches today and last_spawned_on is not today. rrule is one
       of daily, weekly:<sat..fri>, or monthly:<1-28> -- validated in
       lib/tasks/recurrence.ts, no CHECK because the vocabulary may still grow. */
    CREATE TABLE IF NOT EXISTS task_recurrences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      assignee_user_id INTEGER REFERENCES users(id),
      role_hint TEXT,
      group_id INTEGER REFERENCES groups(id),
      entity_type TEXT, entity_id INTEGER,
      priority TEXT NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('CRITICAL', 'HIGH', 'NORMAL', 'LOW')),
      rrule TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      last_spawned_on TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_task_recurrences_active
      ON task_recurrences(organization_id, active);

    /* Phase 8 (Academy): objection-response cards keyed to the outcome_code a
       salesperson picks on a task. organization_id NULL = a shipped starter; a tenant
       overrides by (outcome_code, customer_type). */
    CREATE TABLE IF NOT EXISTS objection_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      outcome_code TEXT NOT NULL,
      customer_type TEXT,
      title_fa TEXT NOT NULL,
      script_fa TEXT NOT NULL,
      module_slug TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, outcome_code, customer_type)
    );

    CREATE TABLE IF NOT EXISTS lesson_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      lesson_slug TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      UNIQUE (organization_id, user_id, lesson_slug)
    );

    /* ---- Phase 9: Analysis ------------------------------------------------------
       The KPI registry. Source §6: every KPI carries seven attributes or it is a
       report, not a management system -- Definition, Formula, Owner, Target,
       Benchmark, Frequency, Action -- plus the Data Dictionary sentence that fixes
       a contested definition once. organization_id NULL = a shipped default
       (seedKpiDefinitions), the reason_codes treatment. */
    CREATE TABLE IF NOT EXISTS kpi_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      metric TEXT NOT NULL,
      title_fa TEXT NOT NULL,
      definition_fa TEXT NOT NULL,
      formula_fa TEXT NOT NULL,
      owner_role TEXT NOT NULL,
      benchmark_fa TEXT,
      frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
      action_fa TEXT NOT NULL,
      tier INTEGER NOT NULL DEFAULT 1,
      direction TEXT NOT NULL DEFAULT 'up' CHECK (direction IN ('up', 'down')),
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, metric)
    );

    /* Precomputed metric values. Written by a sweep (refreshAll); every read on the
       /analysis page and the KPI strip goes through here, never a raw orders scan --
       the second SQLite-scaling condition in Part 2 of the plan. scope_id is NOT NULL
       DEFAULT 0 (0 = the whole scope_type, i.e. org-level) so the UNIQUE never has to
       reason about NULL -- the targets-table NULL-in-UNIQUE trap, sidestepped by
       construction. numerator/denominator let a drill-down re-aggregate a ratio
       without re-scanning; sample_size is the honesty hook -- a figure off three
       orders is not a figure off three hundred. */
    CREATE TABLE IF NOT EXISTS kpi_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      metric TEXT NOT NULL,
      scope_type TEXT NOT NULL
        CHECK (scope_type IN ('org', 'group', 'salesperson', 'driver', 'customer', 'product', 'representative')),
      scope_id INTEGER NOT NULL DEFAULT 0,
      period TEXT NOT NULL,
      value REAL NOT NULL,
      numerator REAL,
      denominator REAL,
      sample_size INTEGER,
      computed_at TEXT NOT NULL,
      UNIQUE (organization_id, metric, scope_type, scope_id, period)
    );
    CREATE INDEX IF NOT EXISTS ix_kpi_snapshots_read
      ON kpi_snapshots(organization_id, period, metric, scope_type);

    /* ---- Phase 10: Prediction -------------------------------------------------
       The company has no history yet. Every predictor estimates for the cold-start
       year off these shipped season multipliers, then switches to incremental
       learning. organization_id NULL = a shipped default (seedSeasonalFactors), the
       reason_codes treatment; a tenant may tune its own once it has a year of data. */
    CREATE TABLE IF NOT EXISTS seasonal_factors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      kind TEXT NOT NULL CHECK (kind IN ('month', 'dow')),
      idx INTEGER NOT NULL,
      factor REAL NOT NULL DEFAULT 1,
      note_fa TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, kind, idx)
    );

    /* The learned state of one demand series, folded forward one closed Jalali month
       at a time. seasonal_naive until n_obs >= 8, then Holt (level + trend). */
    CREATE TABLE IF NOT EXISTS forecast_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      entity_type TEXT NOT NULL CHECK (entity_type IN ('org', 'group', 'product')),
      entity_id INTEGER NOT NULL DEFAULT 0,
      metric TEXT NOT NULL CHECK (metric IN ('demand_base_units', 'demand_toman')),
      method TEXT NOT NULL DEFAULT 'seasonal_naive',
      level REAL, trend REAL,
      alpha REAL NOT NULL DEFAULT 0.4,
      beta REAL NOT NULL DEFAULT 0.15,
      n_obs INTEGER NOT NULL DEFAULT 0,
      mae REAL,
      last_period TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id, entity_type, entity_id, metric)
    );

    /* Materialised predictions the pages + routing read. */
    CREATE TABLE IF NOT EXISTS forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL DEFAULT 0,
      metric TEXT NOT NULL,
      target_period TEXT NOT NULL,
      horizon INTEGER NOT NULL,
      yhat REAL NOT NULL, yhat_lo REAL NOT NULL, yhat_hi REAL NOT NULL,
      method TEXT NOT NULL,
      computed_at TEXT NOT NULL,
      UNIQUE (organization_id, entity_type, entity_id, metric, target_period)
    );
    CREATE INDEX IF NOT EXISTS ix_forecasts_read
      ON forecasts(organization_id, entity_type, metric, target_period);

    /* One logistic weight vector per tenant. organization_id NULL = shipped defaults
       (seedChurnModel), the reason_codes treatment. */
    CREATE TABLE IF NOT EXISTS churn_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER REFERENCES organizations(id),
      weights_json TEXT NOT NULL,
      n_obs INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (organization_id)
    );

    /* Materialised churn probability per customer. */
    CREATE TABLE IF NOT EXISTS churn_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      probability REAL NOT NULL,
      band TEXT NOT NULL CHECK (band IN ('low', 'watch', 'high')),
      reason_fa TEXT,
      computed_at TEXT NOT NULL,
      UNIQUE (organization_id, customer_id)
    );

    /* When each template runs. cutoff_time: after this, adding an order to that day's run
       needs an explicit decision (see lib/repo/routing.freezeRun + addStop force). */
    CREATE TABLE IF NOT EXISTS route_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      route_template_id INTEGER NOT NULL REFERENCES route_templates(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL,
      start_time TEXT,
      end_time TEXT,
      cutoff_time TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE (route_template_id, day_of_week)
    );
  `);

  /* Nullable, and null means no limit rather than a limit of zero -- most customers do
     not have one, and a default of 0 would refuse every sale on the day it shipped. */
  /* What a planned visit is FOR. Nullable, because every row written before this column
     existed has no answer and inventing one would be a fabricated record — the schedule
     shows those as «بدون هدف» rather than guessing.

     No CHECK constraint: SQLite cannot ALTER one in, so a constrained column here would
     mean rebuilding the table, and the vocabulary is young enough that it is likely to
     gain a value. lib/tripPurpose.ts is the single place that defines what is valid, and
     it is what the UI and the API both read. */
  const visitPlanCols = db.prepare("PRAGMA table_info(visit_plans)").all() as { name: string }[];
  if (!visitPlanCols.some((c) => c.name === "purpose")) {
    db.exec("ALTER TABLE visit_plans ADD COLUMN purpose TEXT");
  }

  const customerCreditCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!customerCreditCols.some((c) => c.name === "credit_limit_toman")) {
    db.exec("ALTER TABLE customers ADD COLUMN credit_limit_toman INTEGER");
  }

  /* Reorder policy, per product -- in the product's own base_unit, same as on_hand.
     Both null until an owner sets them: a product nobody has configured yet must read
     as "no threshold set", not as "zero stock is fine" or "already critical". Stock
     itself stays derived (see lib/purchases.ts); these two are the one thing about
     inventory that is not a fact to compute but a decision to store. */
  const productStockCols = db.prepare("PRAGMA table_info(products)").all() as { name: string }[];
  if (!productStockCols.some((c) => c.name === "reorder_point")) {
    db.exec("ALTER TABLE products ADD COLUMN reorder_point REAL");
  }
  if (!productStockCols.some((c) => c.name === "target_stock")) {
    db.exec("ALTER TABLE products ADD COLUMN target_stock REAL");
  }
  // Phase 2 (Stock & Batches): shelf life in days, for defaulting a batch's expiry_date
  // (produced_at + shelf_life_days) and sizing the expiry-alert window. Nullable -- a
  // product with no shelf life set just gets a flat fallback window.
  if (!productStockCols.some((c) => c.name === "shelf_life_days")) {
    db.exec("ALTER TABLE products ADD COLUMN shelf_life_days INTEGER");
  }

  // saved_locations shipped with CHECK constraints that lagged the valid resolution
  // values over time ('nominatim', then 'manual') -- CREATE TABLE IF NOT EXISTS never
  // re-applies a constraint change to an already-created table, and SQLite has no ALTER
  // for CHECK, so the fix is to rebuild it (standard SQLite pattern: new table under a
  // temp name, copy every row across, drop the old one, rename into place) rather than
  // skip whenever rows already exist -- real saved locations from before this migration
  // must survive it.
  const savedLocationsSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='saved_locations'")
    .get() as { sql: string } | undefined;
  if (savedLocationsSchema && !savedLocationsSchema.sql.includes("'browser'")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE saved_locations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          maps_url TEXT UNIQUE NOT NULL,
          address TEXT,
          lat REAL,
          lng REAL,
          resolution TEXT NOT NULL DEFAULT 'unresolved'
            CHECK (resolution IN ('direct', 'pluscode', 'browser', 'nominatim', 'manual', 'unresolved')),
          notes TEXT,
          organization_id INTEGER REFERENCES organizations(id),
          group_id INTEGER REFERENCES groups(id),
          status TEXT CHECK (status IN ('contacted', 'visited', 'no_answer', 'declined')),
          visit_outcome TEXT,
          rating_potential INTEGER,
          rating_volume INTEGER,
          rating_ease INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
        INSERT INTO saved_locations_new SELECT * FROM saved_locations;
        DROP TABLE saved_locations;
        ALTER TABLE saved_locations_new RENAME TO saved_locations;
        CREATE INDEX IF NOT EXISTS idx_saved_locations_name ON saved_locations(name);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  const savedLocationCols = db.prepare("PRAGMA table_info(saved_locations)").all() as { name: string }[];
  if (!savedLocationCols.some((c) => c.name === "notes")) {
    db.exec("ALTER TABLE saved_locations ADD COLUMN notes TEXT");
  }
  if (!savedLocationCols.some((c) => c.name === "status")) {
    db.exec("ALTER TABLE saved_locations ADD COLUMN status TEXT");
  }
  if (!savedLocationCols.some((c) => c.name === "updated_at")) {
    // Drives the GET /api/locations ETag signature the same way districts.updated_at
    // drives districts' -- without a column that changes on UPDATE (not just INSERT),
    // a PATCH (pin drop, status change) leaves the list's cache signature unchanged and
    // the client silently keeps showing the pre-PATCH state via a 304.
    db.exec("ALTER TABLE saved_locations ADD COLUMN updated_at TEXT");
    db.exec("UPDATE saved_locations SET updated_at = created_at WHERE updated_at IS NULL");
  }

  // Prospect scoring. Three nullable columns rather than a ratings table: the criteria
  // are fixed and there is exactly one score per criterion per location, so a join would
  // buy nothing and cost every read. NULL is "not judged yet", which is deliberately not
  // the same as a score of zero.
  for (const col of ["rating_potential", "rating_volume", "rating_ease"]) {
    if (!savedLocationCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE saved_locations ADD COLUMN ${col} INTEGER`);
    }
  }

  const districtCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtCols.some((c) => c.name === "assigned_to")) {
    db.exec("ALTER TABLE districts ADD COLUMN assigned_to TEXT");
  }

  const activityCols = db.prepare("PRAGMA table_info(activity_log)").all() as { name: string }[];
  if (!activityCols.some((c) => c.name === "changed_by")) {
    db.exec("ALTER TABLE activity_log ADD COLUMN changed_by TEXT");
  }

  // Districts are ranked by how far away they are, which needs one point per district.
  // Stored rather than derived per request: readDistrictProperties deliberately does not
  // read boundary_geojson (it is ~600KB across the table), and computing centroids on
  // every request would reintroduce exactly the read that split was made to avoid.
  // activity_log carries the same district/customer-only CHECK and needs the same
  // rebuild, for the same reason: a restock stop added to a day, and (feature 11) an
  // arrival logged at a depot, are both events about a facility. Widening it here rather
  // than skipping the log for facilities keeps one history for everything on the map.
  // activity_log shipped with entity_type restricted to district/customer/facility.
  // SQLite cannot ALTER a CHECK, so widening it to accept lead_location means the standard rebuild.
  const activitySchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_log'")
    .get() as { sql: string } | undefined;
  if (activitySchema && !activitySchema.sql.includes("'lead_location'")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE activity_log_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'facility', 'lead_location')),
          entity_id INTEGER NOT NULL,
          event_type TEXT NOT NULL CHECK (event_type IN ('status_change', 'note', 'assigned')),
          old_value TEXT,
          new_value TEXT,
          note TEXT,
          changed_by TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO activity_log_new (id, entity_type, entity_id, event_type, old_value, new_value, note, changed_by, created_at)
          SELECT id, entity_type, entity_id, event_type, old_value, new_value, note, changed_by, created_at FROM activity_log;
        DROP TABLE activity_log;
        ALTER TABLE activity_log_new RENAME TO activity_log;
        CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id, created_at);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // users predates roles entirely: it was a username/password/display_name table backing
  // an optional named login, back when a shared password was the usual way in. Roles and
  // group scoping need
  // a CHECK constraint, which SQLite cannot add via ALTER, so this is the standard
  // rebuild.
  //
  // Existing rows become 'owner' on purpose. Those accounts already have unrestricted
  // access today (the app has no scoping at all), so 'owner' preserves exactly the
  // access they have rather than silently revoking it -- a migration that locks the user
  // out of their own production app is a worse failure than one that defers a demotion
  // to the admin screen.
  const usersSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersSchema && !usersSchema.sql.includes("token_version")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('owner', 'group_manager', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_new (id, username, password_hash, display_name, role, created_at)
          SELECT id, username, password_hash, display_name, 'owner', created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // 'salesperson' joins the roles. The manager aggregates cold-call orders today; the
  // three people already named in customers.salesperson get their own accounts once the
  // sales section can show each of them their own orders and nobody else's.
  //
  // SQLite cannot ALTER a CHECK, so this is the same rebuild as above -- with one thing
  // the earlier rebuilds did not have to handle. activity_log.changed_by_user_id now
  // REFERENCES users(id), and DROP TABLE on a table a foreign key points at raises a
  // constraint violation while enforcement is on. PRAGMA foreign_keys is a silent no-op
  // inside a transaction, so it has to be toggled around the whole thing, not within it.
  const usersRoleSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersRoleSchema && !usersRoleSchema.sql.includes("phone_sales")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_role_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('owner', 'group_manager', 'salesperson', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_role_new
          (id, username, password_hash, display_name, role, group_id, staff_code, phone,
           active, token_version, location_consent_at, created_at)
          SELECT id, username, password_hash, display_name, role, group_id, staff_code, phone,
                 active, token_version, location_consent_at, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_role_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      // Always, including on the failure path: leaving a connection with enforcement off
      // would silently drop referential integrity for every write that followed.
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // ---- Tenancy (RouteFlow Phase 0a, Task 1) -------------------------------------------
  //
  // One database, several companies. The boundary is organization_id, and it is enforced
  // in lib/session.ts rather than at every call site: scopeGroupIds already funnels every
  // scoped read, and redefining what `owner` means there covers the group-scoped tables
  // without touching them.

  // Seeded rather than left to a UI. Every backfill below needs an id to point at, and
  // there is exactly one company in this database at the moment the column appears.
  const orgCount = db.prepare("SELECT COUNT(*) AS n FROM organizations").get() as unknown as {
    n: number;
  };
  if (orgCount.n === 0) {
    db.prepare(
      `INSERT INTO organizations (id, name, slug, plan, active, created_at)
       VALUES (1, ?, ?, 'standard', 1, ?)`
    ).run("طعمینو", "tameeno", new Date().toISOString());
  }

  // users first: every scoping decision reads the organisation off the session, which
  // reads it off the user row.
  const userOrgCols = db.prepare("PRAGMA table_info(users)").all() as unknown as { name: string }[];
  if (!userOrgCols.some((c) => c.name === "organization_id")) {
    db.exec("ALTER TABLE users ADD COLUMN organization_id INTEGER REFERENCES organizations(id)");
  }
  // Backfilled on every boot rather than only alongside the ALTER. During a rolling
  // deploy an older build is still inserting rows that know nothing about the column, and
  // a row with a null tenant is invisible to every scoped query -- an account that cannot
  // see anything and cannot be told why.
  db.exec("UPDATE users SET organization_id = 1 WHERE organization_id IS NULL");

  // Widen users.role to admit platform_owner: the vendor account, which reads across
  // tenants so support is possible at all. Guarded on the constraint text rather than on
  // a column, because the columns are unchanged -- it is the CHECK that has to move.
  // Same rebuild dance, and the same reasons, as the salesperson widening above.
  const usersPlatformSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersPlatformSchema && !usersPlatformSchema.sql.includes("platform_owner")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_platform_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'salesperson', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          organization_id INTEGER REFERENCES organizations(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_platform_new
          (id, username, password_hash, display_name, role, group_id, organization_id,
           staff_code, phone, active, token_version, location_consent_at, created_at)
          SELECT id, username, password_hash, display_name, role, group_id, organization_id,
                 staff_code, phone, active, token_version, location_consent_at, created_at
            FROM users;
        DROP TABLE users;
        ALTER TABLE users_platform_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      // Always, including on the failure path: leaving a connection with enforcement off
      // would silently drop referential integrity for every write that followed.
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // Phase 0b: widen users.role again to admit rep_manager -- the person who runs the
  // representative network for one organisation. Same rebuild dance and reasons as the
  // platform_owner widening above, guarded on the constraint text.
  const usersRepMgrSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersRepMgrSchema && !usersRepMgrSchema.sql.includes("rep_manager")) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_repmgr_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'rep_manager', 'salesperson', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          organization_id INTEGER REFERENCES organizations(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO users_repmgr_new
          (id, username, password_hash, display_name, role, group_id, organization_id,
           staff_code, phone, active, token_version, location_consent_at, created_at)
          SELECT id, username, password_hash, display_name, role, group_id, organization_id,
                 staff_code, phone, active, token_version, location_consent_at, created_at
            FROM users;
        DROP TABLE users;
        ALTER TABLE users_repmgr_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // CRM (docs/superpowers/specs/2026-09-11-crm-leads-customers-design.md): created before the
  // TENANT_TABLES loop below, which ALTERs every table it lists.
  createCrmTables(db);

  /* facilities: icon_key added, and 'home_base' renamed to 'home'.
   *
   * An ALTER, not a table rebuild. The CHECK constraint still names the old kind, and
   * SQLite cannot alter a CHECK -- so the rebuild copies in `rebuildForTenantUnique` below
   * is what actually installs the new one, and this step's job is only to (a) add the
   * column and (b) rewrite the values so the copy does not violate the NEW check it is
   * about to be written against.
   *
   * The rename is data, not schema: 'base' reads as a company camp, which is not what a
   * driver's own house is, and the user writes this kind by hand when they add a home. */
  {
    const fCols = db.prepare("PRAGMA table_info(facilities)").all() as unknown as { name: string }[];
    if (!fCols.some((c) => c.name === "icon_key")) {
      db.exec("ALTER TABLE facilities ADD COLUMN icon_key TEXT");
    }
    /* The CHECK is widened by the rebuild further down (facilities_tn_new), which runs LATER.
     * So this UPDATE cannot run first: against a database still carrying the old CHECK it
     * fails with "CHECK constraint failed: kind IN ('warehouse','home_base','other','van')"
     * on the very write that is meant to remove the offending value.
     *
     * The two tables disagree about the kind list until the rebuild happens -- which is
     * exactly what the comment on rebuildForTenantUnique's own facilities block warns about,
     * one step later than it bites. So: widen the live table FIRST, then rename inside it. */
    const liveCheck = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='facilities'").get() as
      | { sql: string }
      | undefined)?.sql;
    if (liveCheck && !liveCheck.includes("'home'")) {
      /* Use rebuildForTenantUnique rather than hand-rolling a third copy of it.
       *
       * The hand-rolled version this replaces was wrong in three separate ways, and every one
       * of them only shows on a database that has history:
       *
       *  1. `DROP TABLE facilities` with foreign keys ON fails on any database with rows in
       *     stock_movements (facility_id NOT NULL, db.ts:2265) or vehicles (:4667) — both of
       *     which reference facilities(id). A fresh install passes because both are empty, which
       *     is exactly why this survived until a test copied a real backup.
       *  2. It declared a SUBSET of the columns, silently dropping icon_key, address, maps_url,
       *     notes and group_id — and then the tenant-unique rebuild further down failed with
       *     "NOT NULL constraint failed: facilities_tn_new.updated_at" while copying.
       *  3. No `DROP TABLE IF EXISTS` on the scratch table, so a process dying between the DROP
       *     and the RENAME left it behind and the next boot failed with "already exists".
       *
       * The helper suspends foreign keys in a try/finally, reads its column list from
       * PRAGMA table_info instead of hard-coding one, and starts with DROP IF EXISTS. Every
       * migration that rewrites a table should call it; a fourth bespoke copy is how the three
       * bugs above happened.
       *
       * It copies kind verbatim, so the rename has to happen INSIDE the copy. Hence the _kind
       * table here: the helper needs to find the destination by name, and the CASE belongs in
       * the SELECT that the helper builds. The column the helper reads is the live one, so the
       * rewrite is applied by making the helper's SELECT see 'home' -- which it cannot, hence
       * the small custom copy below, kept deliberately minimal and derived from table_info. */
      const liveCols = (db.prepare("PRAGMA table_info(facilities)").all() as unknown as { name: string }[])
        .map((c) => c.name);
      const select = liveCols
        .map((c) => (c === "kind" ? "CASE kind WHEN 'home_base' THEN 'home' ELSE kind END" : c))
        .join(", ");
      const cols = liveCols.map((c) => `"${c}"`).join(", ");

      db.exec("PRAGMA foreign_keys = OFF");
      try {
        db.exec(`
          DROP TABLE IF EXISTS facilities_kind_new;
          CREATE TABLE facilities_kind_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'factory', 'van', 'home',
                                               'office', 'shop', 'cold_storage', 'parking', 'other')),
            name TEXT NOT NULL,
            icon_key TEXT,
            address TEXT,
            lat REAL,
            lng REAL,
            maps_url TEXT,
            notes TEXT,
            is_default_origin INTEGER NOT NULL DEFAULT 0,
            owner_username TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            group_id INTEGER REFERENCES groups(id),
            organization_id INTEGER REFERENCES organizations(id)
          );
          INSERT INTO facilities_kind_new (${cols}) SELECT ${select} FROM facilities;
          DROP TABLE facilities;
          ALTER TABLE facilities_kind_new RENAME TO facilities;
        `);
      } finally {
        db.exec("PRAGMA foreign_keys = ON");
      }
      const indexes = db
        .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='facilities' AND sql IS NOT NULL")
        .all() as unknown as { name: string; sql: string }[];
      for (const ix of indexes) db.exec(ix.sql);
    }
    const renamed = db
      .prepare("UPDATE facilities SET kind = 'home' WHERE kind = 'home_base'")
      .run();
    if (renamed.changes > 0) {
      const left = db
        .prepare("SELECT COUNT(*) n FROM facilities WHERE kind = 'home_base'")
        .get() as { n: number };
      if (left.n > 0) throw new Error("facilities: home_base could not be migrated to home");
    }
  }

  // ALTER each table now, up front, and backfill immediately -- both matter here, not
  // just the column. seedFacilities runs later in this same function and relies on
  // "INSERT OR IGNORE" recognising an existing (organization_id, slug) row to skip it;
  // on a database that already has facilities rows from before this migration, those
  // rows still carry organization_id = NULL at the moment seedFacilities runs unless
  // they are backfilled first. Backfilling only *after* seedFacilities -- which is what
  // "runs every boot" originally meant here -- has the steps in the wrong order: it lets
  // seedFacilities insert a fresh (1, slug) row next to the untouched (NULL, slug) row,
  // and then the backfill's own UPDATE collides with the row seedFacilities just made.
  // A second, final sweep further down still runs as a safety net for anything inserted
  // by a migration step that comes after this one.
  for (const table of TENANT_TABLES) {
    const tenantCols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
      name: string;
    }[];
    if (!tenantCols.some((c) => c.name === "organization_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN organization_id INTEGER REFERENCES organizations(id)`);
    }
    // reason_codes keeps its NULL rows -- they are the shared system defaults.
    if (
      table === "reason_codes" ||
      table === "capacity_factors" ||
      table === "rules" ||
      table === "notification_types" ||
      table === "objection_cards" ||
      table === "kpi_definitions" ||
      table === "seasonal_factors" ||
      table === "churn_models"
    )
      continue;
    db.exec(`UPDATE ${table} SET organization_id = 1 WHERE organization_id IS NULL`);
  }

  // Seven natural keys move from globally unique to unique-per-tenant. Two companies
  // must be able to independently use customer code C001, SKU KR250, district «منطقه ۱»
  // -- without this, the second organisation to try any of those hits a UNIQUE violation
  // that has nothing to do with anything they themselves have done.
  //
  // users.username deliberately does NOT move: there is one login form with no
  // organisation picker, so a username has to identify a person across the whole system.

  rebuildForTenantUnique(
    db,
    "customers",
    "UNIQUE (organization_id, customer_code)",
    `CREATE TABLE customers_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_code TEXT NOT NULL,
      business_name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      province TEXT,
      lat REAL,
      lng REAL,
      status TEXT,
      salesperson TEXT,
      debt_0_7 REAL DEFAULT 0,
      debt_8_30 REAL DEFAULT 0,
      debt_30_plus REAL DEFAULT 0,
      notes TEXT,
      synced_at TEXT NOT NULL,
      last_purchase_date TEXT,
      group_id INTEGER REFERENCES groups(id),
      credit_limit_toman INTEGER,
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, customer_code)
    );`
  );

  rebuildForTenantUnique(
    db,
    "products",
    "UNIQUE (organization_id, sku)",
    `CREATE TABLE products_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT,
      base_unit TEXT NOT NULL DEFAULT 'عدد',
      kg_per_base_unit REAL NOT NULL DEFAULT 0,
      avg_cost_toman INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      reorder_point REAL,
      target_stock REAL,
      shelf_life_days INTEGER,
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, sku)
    );`
  );

  // Both of groups' constraints move together -- guarded on the name constraint alone,
  // since a CREATE that changes one and not the other would leave the table half done.
  rebuildForTenantUnique(
    db,
    "groups",
    "UNIQUE (organization_id, name)",
    `CREATE TABLE groups_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, name),
      UNIQUE (organization_id, slug)
    );`
  );

  rebuildForTenantUnique(
    db,
    "orders",
    "UNIQUE (organization_id, order_no)",
    `CREATE TABLE orders_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      group_id INTEGER REFERENCES groups(id),
      salesperson_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'delivered', 'cancelled')),
      order_date TEXT NOT NULL,
      delivered_at TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid'
        CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
      paid_toman INTEGER NOT NULL DEFAULT 0,
      credit_override_by INTEGER REFERENCES users(id),
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, order_no)
    );`
  );

  // Shared geography, so the opposite of its seven siblings: this one REMOVES the tenant
  // scoping rather than adding it. It has to run before the group_id and centroid ALTERs
  // below, which then re-add those columns to the fresh table.
  rebuildDistrictsShared(db);
  /* Phase 8: widen facilities.kind to allow a van. Must run BEFORE the tenant-unique pass below
     so that pass sees the UNIQUE marker this leaves behind and does not fire a second time. */
  rebuildFacilitiesForVan(db);

  rebuildForTenantUnique(
    db,
    "saved_locations",
    "UNIQUE (organization_id, maps_url)",
    `CREATE TABLE saved_locations_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      maps_url TEXT NOT NULL,
      address TEXT,
      lat REAL,
      lng REAL,
      resolution TEXT NOT NULL DEFAULT 'unresolved'
        CHECK (resolution IN ('direct', 'pluscode', 'browser', 'nominatim', 'manual', 'unresolved')),
      notes TEXT,
      created_at TEXT NOT NULL,
      status TEXT,
      updated_at TEXT,
      rating_potential INTEGER,
      rating_volume INTEGER,
      rating_ease INTEGER,
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      visit_outcome TEXT,
      UNIQUE (organization_id, maps_url)
    );`
  );

  /* `facilities` — and its CHECK must name 'van', or this rebuild silently UNDOES the one above.
   *
   *  There are two places the facilities schema is written out, and they used to disagree about
   *  the kind list. On a fresh database the schema block creates the table with the new list, this
   *  helper then sees the missing UNIQUE and rebuilds from ITS OWN literal — so whichever list it
   *  carries is the one that survives. Adding 'van' only to the CREATE was not enough, and the
   *  symptom was a CHECK constraint failure on the first insert of a van, a long way from here.
   *  Every migration that rewrites a table must update every writer of that table's DDL. */
  rebuildForTenantUnique(
    db,
    "facilities",
    "UNIQUE (organization_id, slug)",
    `CREATE TABLE facilities_tn_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'factory', 'van', 'home',
                                   'office', 'shop', 'cold_storage', 'parking', 'other')),
      name TEXT NOT NULL,
      /* The icon is the person's choice, not the kind's. It used to be derived from the
         kind, which meant a kind could only ever look like one thing, and adding a kind
         retroactively changed what every existing place of that kind looked like. NULL
         until chosen; the UI falls back to the kind's first option. */
      icon_key TEXT,
      address TEXT,
      /* Nullable, matching the other two facilities DDL copies -- see the long comment on
       * facilities.lat. This rebuild is the one that bites: it re-creates the table on
       * every tenant bootstrap, so a NOT NULL here puts the constraint straight back for
       * anyone whose data survives the rebuild. */
      lat REAL,
      lng REAL,
      maps_url TEXT,
      notes TEXT,
      is_default_origin INTEGER NOT NULL DEFAULT 0,
      owner_username TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, slug)
    );`
  );

  // Territory. Nullable rather than NOT NULL: a district nobody has claimed yet is a
  // real state, and it is different from one deliberately given to a group.
  const districtGroupCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtGroupCols.some((c) => c.name === "group_id")) {
    db.exec("ALTER TABLE districts ADD COLUMN group_id INTEGER REFERENCES groups(id)");
  }

  // A cache, not a source of truth -- recomputed from district containment by
  // recomputeCustomerGroups() whenever territory changes or customers are imported.
  // Stored rather than derived per query because deriving it means point-in-polygon
  // against 369 polygons per customer, per request.
  const customerGroupCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!customerGroupCols.some((c) => c.name === "group_id")) {
    db.exec("ALTER TABLE customers ADD COLUMN group_id INTEGER REFERENCES groups(id)");
  }

  // Group ownership for the tables that are owned outright rather than through what they
  // point at (spec §2.3 / Task 8). saved_locations, lead_lists and facilities each belong
  // to one group from the moment they are created, so they carry their own column and it
  // is stamped from the creating session.
  //
  // photos, reminders and visit_plans deliberately do NOT get one: their
  // (entity_type, entity_id) already names a customer, district or facility that carries
  // the group, so they join to it instead. That way a district changing hands takes its
  // reminders and photos with it, with no second copy of the truth to keep in step.
  for (const table of ["saved_locations", "lead_lists", "facilities"] as const) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "group_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN group_id INTEGER REFERENCES groups(id)`);
    }
  }

  // activity_log.changed_by holds a display name, so renaming someone rewrites their
  // history and two people with the same name are indistinguishable. Record the id too.
  const activityActorCols = db.prepare("PRAGMA table_info(activity_log)").all() as { name: string }[];
  if (!activityActorCols.some((c) => c.name === "changed_by_user_id")) {
    // changed_by stays: it is what the history UI renders, and it must keep reading
    // correctly for rows written before this column existed, which have no id to look up.
    db.exec("ALTER TABLE activity_log ADD COLUMN changed_by_user_id INTEGER REFERENCES users(id)");
  }

  // visit_plans shipped with entity_type restricted to district/customer. SQLite cannot
  // ALTER a CHECK, so widening it to accept a facility and lead_location means the standard rebuild:
  // new table, copy every row, drop, rename. Guarded on the constraint text so it runs
  // exactly once. Same dance saved_locations went through above.
  const visitPlansSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='visit_plans'")
    .get() as { sql: string } | undefined;
  if (visitPlansSchema && !visitPlansSchema.sql.includes("'lead_location'")) {
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE visit_plans_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'facility', 'lead_location')),
          entity_id INTEGER NOT NULL,
          planned_date TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'skipped')),
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          purpose TEXT
        );
        INSERT INTO visit_plans_new SELECT * FROM visit_plans;
        DROP TABLE visit_plans;
        ALTER TABLE visit_plans_new RENAME TO visit_plans;
        CREATE INDEX IF NOT EXISTS idx_visit_plans_date ON visit_plans(planned_date);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // Phase 1 (Money): a POS / card-to-card payment can carry a receipt photo, so photos
  // must accept entity_type 'payment'. SQLite cannot ALTER a CHECK -- same rebuild the
  // visit_plans widening above uses, guarded on the constraint text so it runs once.
  const photosSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='photos'")
    .get() as { sql: string } | undefined;
  if (photosSchema && !photosSchema.sql.includes("'payment'")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE photos_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'payment')),
          entity_id INTEGER NOT NULL,
          file_stem TEXT UNIQUE NOT NULL,
          caption TEXT,
          taken_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO photos_new SELECT id, entity_type, entity_id, file_stem, caption, taken_at, created_at FROM photos;
        DROP TABLE photos;
        ALTER TABLE photos_new RENAME TO photos;
        CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_id, taken_at);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }

  // Phase 1 (Money): an order that breaches a direct customer's credit limit is parked
  // -- credit_hold = 1 -- until a credit_approvals decision releases it. No CHECK, so a
  // plain ADD COLUMN, guarded on the column's absence.
  const orderCols = db.prepare("PRAGMA table_info(orders)").all() as { name: string }[];
  if (!orderCols.some((c) => c.name === "credit_hold")) {
    db.exec("ALTER TABLE orders ADD COLUMN credit_hold INTEGER NOT NULL DEFAULT 0");
  }

  // Phase 3: widen orders.status from 'draft/confirmed/delivered/cancelled' to the
  // 12+2-state machine (lib/orderStateMachine.ts). Runs here, after the credit_hold
  // ADD COLUMN above, so the rebuild's value map can read credit_hold on every path.
  // Guarded on the CHECK already naming PENDING_REVIEW.
  rebuildOrdersStatusMachine(db);

  // Phase 3 (M6): delivery_line_batches gains a link to the deliveries row. Plain ADD,
  // nullable -- Phase 2's backfilled rows keep only delivery_stop_id; new code writes
  // both.
  const dlbCols = db.prepare("PRAGMA table_info(delivery_line_batches)").all() as { name: string }[];
  if (!dlbCols.some((c) => c.name === "delivery_id")) {
    db.exec("ALTER TABLE delivery_line_batches ADD COLUMN delivery_id INTEGER REFERENCES deliveries(id)");
  }


  const districtCentroidCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtCentroidCols.some((c) => c.name === "centroid_lat")) {
    db.exec("ALTER TABLE districts ADD COLUMN centroid_lat REAL");
    db.exec("ALTER TABLE districts ADD COLUMN centroid_lng REAL");
  }
  backfillDistrictCentroids(db);

  // A short, speakable code per district, and the منطقه number as an integer.
  //
  // parent_no exists because the two source files spell the same district differently --
  // map.tehran.ir writes "منطقه ۱۴ شهر تهران" and our own mahalle.geojson writes "منطقه 14"
  // -- and UNIQUE(name, level, parent_name) joins on the name. An integer cannot be
  // spelled two ways, so the 369 محله resolve to their منطقه regardless of which file they
  // came from.
  //
  // The code index is PARTIAL-unique. A hand-drawn district (is_custom = 1) has no code
  // until an operator assigns one, and a hard UNIQUE would fail the moment two of them sat
  // blank -- which is exactly the state a freshly drawn district is in.
  //
  // Assigned by scripts/assign-district-codes.ts, never here. A code written during boot
  // would be recomputed on every seed, so a split would renumber existing districts and
  // every printed route sheet would silently point somewhere else.
  const districtCodeCols = db.prepare("PRAGMA table_info(districts)").all() as { name: string }[];
  if (!districtCodeCols.some((c) => c.name === "code")) {
    db.exec("ALTER TABLE districts ADD COLUMN code TEXT");
  }
  if (!districtCodeCols.some((c) => c.name === "parent_no")) {
    db.exec("ALTER TABLE districts ADD COLUMN parent_no INTEGER");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ix_districts_code ON districts(code) WHERE code IS NOT NULL");

  const customerCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!customerCols.some((c) => c.name === "last_purchase_date")) {
    db.exec("ALTER TABLE customers ADD COLUMN last_purchase_date TEXT");
  }

  // Phase 0b: the Excel customer importer is gone. Its bookkeeping tables go with it.
  // DROP IF EXISTS is idempotent and safe to run twice.
  db.exec("DROP TABLE IF EXISTS import_log;");
  db.exec("DROP TABLE IF EXISTS import_snapshots;");

  // Phase 0b M2: customers gains a lifecycle, a type, credit terms and a parent link,
  // and loses the free-text `status` column (its values map onto `lifecycle`). SQLite
  // cannot ALTER ADD a CHECK constraint, so this is a table rebuild -- guarded on the
  // new `lifecycle` column so it runs exactly once.
  const custM2Cols = (db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]).map((c) => c.name);
  if (!custM2Cols.includes("lifecycle")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE customers_m2_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_code TEXT NOT NULL,
          business_name TEXT NOT NULL,
          contact_person TEXT,
          phone TEXT,
          address TEXT,
          city TEXT,
          province TEXT,
          lat REAL,
          lng REAL,
          salesperson TEXT,
          debt_0_7 REAL DEFAULT 0,
          debt_8_30 REAL DEFAULT 0,
          debt_30_plus REAL DEFAULT 0,
          notes TEXT,
          synced_at TEXT NOT NULL,
          last_purchase_date TEXT,
          group_id INTEGER REFERENCES groups(id),
          credit_limit_toman INTEGER,
          organization_id INTEGER REFERENCES organizations(id),
          customer_type TEXT CHECK (customer_type IN
            ('RESTAURANT','HOTEL','CATERING','CAFE','RETAIL','WHOLESALE','OTHER')),
          lifecycle TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle IN
            ('lead','qualified','sampled','active','dormant','lost','blocked')),
          parent_customer_id INTEGER REFERENCES customers(id),
          payment_terms_days INTEGER NOT NULL DEFAULT 0,
          hard_credit_block INTEGER NOT NULL DEFAULT 0,
          qualified_at TEXT,
          first_order_at TEXT,
          UNIQUE (organization_id, customer_code)
        );
        INSERT INTO customers_m2_new
          (id, customer_code, business_name, contact_person, phone, address, city, province,
           lat, lng, salesperson, debt_0_7, debt_8_30, debt_30_plus, notes, synced_at,
           last_purchase_date, group_id, credit_limit_toman, organization_id, lifecycle)
        SELECT
          id, customer_code, business_name, contact_person, phone, address, city, province,
          lat, lng, salesperson, debt_0_7, debt_8_30, debt_30_plus, notes, synced_at,
          last_purchase_date, group_id, credit_limit_toman, organization_id,
          CASE TRIM(COALESCE(status,''))
            WHEN 'فعال' THEN 'active'
            WHEN 'مشتری فعال' THEN 'active'
            WHEN 'در حال پیگیری' THEN 'qualified'
            WHEN 'نمونه داده شد' THEN 'sampled'
            WHEN 'سرنخ' THEN 'lead'
            WHEN 'غیرفعال' THEN 'dormant'
            WHEN '' THEN 'lead'
            ELSE 'lead'
          END
        FROM customers;
        DROP TABLE customers;
        ALTER TABLE customers_m2_new RENAME TO customers;
        CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
        UPDATE customers
          SET first_order_at = (SELECT MIN(o.order_date) FROM orders o WHERE o.customer_id = customers.id)
          WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = customers.id);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    console.info("[migrate] customers.status -> lifecycle applied; unknown values defaulted to 'lead'");
  }

  // Phase 1 (Money): customer debt is computed from orders now, not stored. The three
  // debt_* columns held demo figures (confirmed 2026-09-02), so they are dropped
  // outright -- no backfill. opening_balance_toman replaces them at 0 for every row; a
  // real pre-app balance is entered per customer through the normal patch path. SQLite
  // cannot DROP a column with an index/constraint cleanly across versions, so this is
  // the same rebuild the m2 block above uses, guarded on debt_0_7 still being present.
  const custDebtCols = (
    db.prepare("PRAGMA table_info(customers)").all() as { name: string }[]
  ).map((c) => c.name);
  if (custDebtCols.includes("debt_0_7")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE customers_ob_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_code TEXT NOT NULL,
          business_name TEXT NOT NULL,
          contact_person TEXT,
          phone TEXT,
          address TEXT,
          city TEXT,
          province TEXT,
          lat REAL,
          lng REAL,
          salesperson TEXT,
          notes TEXT,
          synced_at TEXT NOT NULL,
          last_purchase_date TEXT,
          group_id INTEGER REFERENCES groups(id),
          credit_limit_toman INTEGER,
          organization_id INTEGER REFERENCES organizations(id),
          customer_type TEXT CHECK (customer_type IN
            ('RESTAURANT','HOTEL','CATERING','CAFE','RETAIL','WHOLESALE','OTHER')),
          lifecycle TEXT NOT NULL DEFAULT 'lead' CHECK (lifecycle IN
            ('lead','qualified','sampled','active','dormant','lost','blocked')),
          parent_customer_id INTEGER REFERENCES customers(id),
          payment_terms_days INTEGER NOT NULL DEFAULT 0,
          hard_credit_block INTEGER NOT NULL DEFAULT 0,
          qualified_at TEXT,
          first_order_at TEXT,
          opening_balance_toman INTEGER NOT NULL DEFAULT 0,
          UNIQUE (organization_id, customer_code)
        );
        INSERT INTO customers_ob_new
          (id, customer_code, business_name, contact_person, phone, address, city, province,
           lat, lng, salesperson, notes, synced_at, last_purchase_date, group_id,
           credit_limit_toman, organization_id, customer_type, lifecycle, parent_customer_id,
           payment_terms_days, hard_credit_block, qualified_at, first_order_at)
        SELECT
          id, customer_code, business_name, contact_person, phone, address, city, province,
          lat, lng, salesperson, notes, synced_at, last_purchase_date, group_id,
          credit_limit_toman, organization_id, customer_type, lifecycle, parent_customer_id,
          payment_terms_days, hard_credit_block, qualified_at, first_order_at
        FROM customers;
        DROP TABLE customers;
        ALTER TABLE customers_ob_new RENAME TO customers;
        CREATE INDEX IF NOT EXISTS idx_customers_business_name ON customers(business_name);
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    console.info("[migrate] customers.debt_* dropped; opening_balance_toman added (0)");
  }

  // customers.lead_location_id is the seam between a pin and the customer it became, and
  // it lives HERE rather than beside the other group_id columns further up, because this is
  // the last statement in the boot that touches the shape of `customers`.
  //
  // The two rebuilds above copy an explicit column list, so a column added before them is
  // silently dropped again: a fresh database runs both, and lead_location_id vanished the
  // first time this was written higher up in the file. Adding it after them means no rebuild
  // can undo it, and the guard makes it a no-op on every later boot.
  //
  // Why the column at all, and not the other direction. The convert route used to DELETE the
  // saved_locations row, which is defensible on its own terms -- a promoted venue is not a
  // prospect any more -- but lead_list_items.location_id is ON DELETE CASCADE, so the delete
  // quietly ripped the stop out of every route that referenced it, including the run the
  // driver was standing on. Keeping the pin and pointing the customer at it makes the
  // promotion reversible, keeps the visit history attached to the place it happened, and
  // gives the pool one honest test for "is this still a lead?" instead of a second flag on
  // saved_locations that could disagree with this one.
  const custLeadCols = db.prepare("PRAGMA table_info(customers)").all() as { name: string }[];
  if (!custLeadCols.some((c) => c.name === "lead_location_id")) {
    db.exec("ALTER TABLE customers ADD COLUMN lead_location_id INTEGER REFERENCES saved_locations(id)");
  }
  // Promotions are rare and the lookup is by lead rather than by customer, so this index is
  // not on a hot path -- but it has to be unique per organisation, or two promotions of one
  // pin would both appear to succeed and the second customer would be unreachable.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_lead_location
           ON customers(organization_id, lead_location_id)
           WHERE lead_location_id IS NOT NULL`);

  /* Phase 0b: pins that reached a lead list become customers.
   *
   * This used to run ONCE, guarded on an `app_meta` marker, and that guard was the bug.
   * The fold's predicate is "a pin that is in a lead list" — a fact about ROWS, not
   * about time. A one-shot marker makes it time-dependent: any qualifying row that
   * arrives after the marker is written is never promoted, on any future boot, however
   * long it waits. Which page shows a given lead was then a function of WHEN it was
   * added, and /leads (MANAGE_ROLES, pins) and /crm (CRM_ROLES, customers) could
   * permanently disagree about where it lives. The code permitted that forever, and
   * nothing reconciled the two.
   *
   * So it runs on every boot. The fold is idempotent (ON CONFLICT DO NOTHING on the
   * LEAD-<id> code, the same scheme the manual convert uses, so it cannot collide), and
   * it skips any pin a live lead-run stop points at rather than cascading it away. The
   * cost is a couple of indexed queries per boot; the marker it replaces was saving work
   * at the price of correctness.
   *
   * The old key is left in app_meta untouched — a marker nobody reads is harmless, and
   * deleting it would be a migration for no gain. */
  /* Phase 2 (mixed-route planning): one run per driver-day, holding orders AND visits.
   *
   *  Runs IMMEDIATELY BEFORE the lead-pin fold below, and that is load-bearing rather than
   *  tidy. That fold deletes a pin unless a live run stop protects it, and its query joins
   *  lead_run_stops -> delivery_runs (Phase 2 changed the join target). On a database not yet
   *  folded, lead_run_stops.run_id still holds lead_runs ids, so the join matches NOTHING,
   *  every stop looks unprotected, and the fold deletes pins that are on a live route.
   *
   *  Measured on backups/routeflow-2026-09-30T19-12-20-846Z.db: 58 stops across 6 runs, and 0
   *  id collisions between the two tables. With the join reading lead_runs the pin fold found
   *  0 deletable pins; with it reading delivery_runs before this function ran, it found 31 —
   *  then died on FOREIGN KEY constraint failed, so the whole migration could not boot.
   *
   *  The order is the difference between deleting a driver's assigned work and not.
   *  `foldLeadRunsIntoDeliveryRuns` is a no-op once the table is gone, so calling it first
   *  costs nothing on every boot after the first. */
  foldLeadRunsIntoDeliveryRuns(db);

  foldLeadPinsIntoCustomers(db);

  // Phase 1: give every legacy paid_toman a payment row to stand on before the derived
  // recompute can zero it.
  backfillLegacyPayments(db);

  // Notification system (Phase 1): 'notify' joins ('task','alert') as a rule action_kind
  // so a rule can drive fanOutNotifications. CREATE TABLE IF NOT EXISTS never re-applies a
  // CHECK to an already-created table and SQLite has no ALTER for CHECK, so this is the
  // standard rebuild. rule_runs.rule_id REFERENCES rules(id), so foreign keys are off for
  // the DROP (a no-op inside a transaction, hence toggled around the whole thing).
  const rulesSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rules'")
    .get() as { sql: string } | undefined;
  if (rulesSchema && !rulesSchema.sql.includes("'notify'")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE rules_notify_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          organization_id INTEGER REFERENCES organizations(id),
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          trigger_kind TEXT NOT NULL,
          condition_json TEXT,
          action_kind TEXT NOT NULL CHECK (action_kind IN ('task', 'alert', 'notify')),
          action_json TEXT,
          cooldown_min INTEGER NOT NULL DEFAULT 1440,
          escalate_after_min INTEGER,
          escalate_to_role TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (organization_id, code)
        );
        INSERT INTO rules_notify_new
          (id, organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
           cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
        SELECT
          id, organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
          cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at
        FROM rules;
        DROP TABLE rules;
        ALTER TABLE rules_notify_new RENAME TO rules;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
    console.info("[migrate] rules.action_kind widened to include 'notify'");
  }

  // Notification system (Phase 2, loud channels): plain ADD COLUMN, guarded per column.
  // notification_types gains the loud-by-default hint columns (populated from
  // loudByDefault in seedNotificationTypes); push_subscriptions / users / notifications
  // gain the routing + flush bookkeeping.
  const ntCols = (db.prepare("PRAGMA table_info(notification_types)").all() as { name: string }[]).map((c) => c.name);
  if (!ntCols.includes("default_push")) db.exec("ALTER TABLE notification_types ADD COLUMN default_push INTEGER NOT NULL DEFAULT 0");
  if (!ntCols.includes("default_telegram")) db.exec("ALTER TABLE notification_types ADD COLUMN default_telegram INTEGER NOT NULL DEFAULT 0");

  const psCols = (db.prepare("PRAGMA table_info(push_subscriptions)").all() as { name: string }[]).map((c) => c.name);
  if (!psCols.includes("user_id")) db.exec("ALTER TABLE push_subscriptions ADD COLUMN user_id INTEGER");

  const uCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!uCols.includes("telegram_chat_id")) db.exec("ALTER TABLE users ADD COLUMN telegram_chat_id TEXT");
  if (!uCols.includes("telegram_link_nonce")) db.exec("ALTER TABLE users ADD COLUMN telegram_link_nonce TEXT");
  // A real face, when there is one. Nullable on purpose: most accounts have no photo, and
  // Avatar falls back to initials rather than inventing a face the system does not have.
  if (!uCols.includes("avatar_url")) db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
  // avatar_url names the ROUTE; this names the FILE. Keeping them apart is what lets an
  // avatar_url hold a `?key=chef-2` preset while avatar_stem still points at the real
  // upload -- so clearing a preset does not lose the photograph.
  if (!uCols.includes("avatar_stem")) db.exec("ALTER TABLE users ADD COLUMN avatar_stem TEXT");

  // Widen users.role to the new vocabulary. SQLite cannot ALTER a CHECK, so this is the
  // table-rebuild pattern already used four times in this file -- build the replacement,
  // copy every row, drop, rename.
  //
  // The constraint admits BOTH vocabularies on purpose. A row saying 'driver' is not a bug
  // to be corrected here: it is a person whose primary role is rewritten one step below, and
  // the rewrite needs the constraint to already permit the new name. Narrowing the CHECK to
  // exclude the old names is a separate, later migration -- one that can only run once no
  // row carries them.
  //
  // The copy is driven by PRAGMA table_info rather than a written column list, because
  // telegram_chat_id, telegram_link_nonce, prefs_json, avatar_url and avatar_stem were all
  // added by ALTER after the previous rebuild. A hand-written list drops them, and every
  // user's Telegram link dies with no error anywhere.
  const usersSplitSchema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
    .get() as { sql: string } | undefined;
  if (usersSplitSchema && !usersSplitSchema.sql.includes("phone_sales")) {
    const usersCols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[])
      .map((c) => `"${c.name}"`)
      .join(", ");

    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("BEGIN");
    try {
      db.exec(`
        CREATE TABLE users_rolesplit_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'group_manager'
            CHECK (role IN ('platform_owner', 'owner', 'group_manager', 'rep_manager', 'phone_sales', 'field_rep', 'delivery_driver', 'salesperson', 'driver')),
          group_id INTEGER REFERENCES groups(id),
          organization_id INTEGER REFERENCES organizations(id),
          staff_code TEXT,
          phone TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          token_version INTEGER NOT NULL DEFAULT 0,
          location_consent_at TEXT,
          created_at TEXT NOT NULL,
          telegram_chat_id TEXT,
          telegram_link_nonce TEXT,
          prefs_json TEXT,
          avatar_url TEXT,
          avatar_stem TEXT
        );
        INSERT INTO users_rolesplit_new (${usersCols})
          SELECT ${usersCols} FROM users;
        DROP TABLE users;
        ALTER TABLE users_rolesplit_new RENAME TO users;
      `);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }

  // Now that the CHECK admits them, rewrite the primary role. 'driver' split in two and the
  // column can only name one: it becomes 'delivery_driver', the world these accounts land in
  // today. Their full set (Task 2) carries BOTH, so promoting someone to field_rep later is a
  // one-column update with no backfill.
  db.exec("UPDATE users SET role = 'phone_sales'    WHERE role = 'salesperson'");
  db.exec("UPDATE users SET role = 'delivery_driver' WHERE role = 'driver'");

  // The two TEXT columns that hold a role NAME, which the type system cannot check. A stale
  // value here is a task nobody is ever offered: rules.ts resolves an escalation with
  // `WHERE role = ?`, so a retired name matches no one and the escalation never fires.
  // 'driver' rows are classified by what the task is; role_hint OFFERS work rather than
  // granting access, so the default is field_rep -- a wrongly-offered task is a manager's
  // problem for a day, a wrongly-REMOVED one is work that silently never happens.
  if (db.prepare("SELECT 1 FROM tasks WHERE role_hint = 'salesperson' LIMIT 1").get()) {
    db.exec("UPDATE tasks SET role_hint = 'phone_sales' WHERE role_hint = 'salesperson'");
  }
  if (db.prepare("SELECT 1 FROM tasks WHERE role_hint = 'driver' LIMIT 1").get()) {
    db.exec(`
      UPDATE tasks SET role_hint = 'delivery_driver'
       WHERE role_hint = 'driver' AND kind IN ('delivery', 'deliver', 'stop');
      UPDATE tasks SET role_hint = 'field_rep' WHERE role_hint = 'driver';
    `);
  }
  if (db.prepare("SELECT 1 FROM rules WHERE escalate_to_role = 'salesperson' LIMIT 1").get()) {
    db.exec("UPDATE rules SET escalate_to_role = 'phone_sales' WHERE escalate_to_role = 'salesperson'");
  }
  if (db.prepare("SELECT 1 FROM rules WHERE escalate_to_role = 'driver' LIMIT 1").get()) {
    // An escalation names who to hand a STUCK task to, which is a judgement call rather
    // than a delivery. A manager always exists to unstick it, so this one IS mechanical.
    db.exec("UPDATE rules SET escalate_to_role = 'group_manager' WHERE escalate_to_role = 'driver'");
  }

  /* Multi-role (docs/superpowers/specs/2026-09-28-multi-role-switcher-design.md): a person's
   * roles become a SET, while users.role stays their primary. Guarded on the table being
   * absent, so this runs exactly once and a re-boot is a no-op.
   *
   *  The plan's original version of this migration ALSO copied 'driver' -> both van roles,
   *  because at the time users.role still held the retired name. It no longer does: the
   *  vocabulary migration above has already rewritten every row to phone_sales or
   *  delivery_driver. So today's delivery_driver accounts are ALREADY only delivery_driver
   *  in this table, and the question the plan asked — "does today's driver do both jobs, and
   *  must they keep both on the day this ships?" — can no longer be answered from the column.
   *
   *  The backfill is therefore deliberately honest rather than generous: it copies the
   *  primary verbatim and does NOT invent a second role. Giving a real account a second hat
   *  it was never granted is a privilege change disguised as a migration. A person who does
   *  both jobs is granted both roles explicitly, through the admin screen, by a person who
   *  knows they do both jobs. */
  const hasUserRolesTable = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_roles'")
    .get();
  if (!hasUserRolesTable) {
    db.exec(`
      CREATE TABLE user_roles (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role    TEXT NOT NULL,
        PRIMARY KEY (user_id, role)
      );
    `);
  }
  // The backfill runs on EVERY boot, guarded by INSERT OR IGNORE, and must NOT be keyed on
  // the table's existence: the CREATE TABLE IF NOT EXISTS in the schema block above has
  // already made the table by the time this runs, so a table-existence guard means the
  // backfill never fires on a fresh database. Probed, not assumed — the first version of
  // this guard produced an empty user_roles and a test that said "gives a fresh account its
  // own primary role in the set" and got [].
  db.exec(`
      INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, role FROM users;
      DELETE FROM user_roles WHERE role IN ('driver', 'salesperson');
  `);

  /* A new account MUST land in user_roles, and the plan's version did not arrange that.
   *
   *  Six places insert into users (lib/users.ts, the admin API, create-user.mjs, two seed
   *  scripts, and the platform_owner bootstrap). The plan noted the scripts "do not write
   *  user_roles; that is fine, because the session falls back to the primary when the set
   *  is empty" — true for a SESSION, and false for every ENUMERATION.
   *
   *  The session fallback is a courtesy. The nineteen Task 4a queries are not: they ask
   *  "everyone who can sell / drive / be assigned a run", and they read this table. A
   *  salesperson created this morning with an empty set is invisible to all of them, so
   *  their commission statement comes out empty and nobody notices until payday. The spec
   *  names that exact failure as the reason this table exists, and a backfill that only
   *  runs once would reintroduce it on the very next signup.
   *
   *  So the primary is kept in the set by the DATABASE, not by six call sites that can
   *  each forget. That is what makes the invariant hold for the seventh, unseen one.
   *
   *  IF NOT EXISTS on both: these run on every boot, and a bare CREATE TRIGGER throws
   *  "already exists" on the second one -- taking the whole boot down. */
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS user_roles_after_insert
    AFTER INSERT ON users
    BEGIN
      INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (NEW.id, NEW.role);
    END;

    /* Changing someone's primary must move their set with it, or Task 3's session.roles
     * would read a stale set and hand them permissions their column no longer claims.
     *
     *  The set is replaced ONLY when it still holds nothing but the old primary — i.e. the
     *  person never had a second hat. A set with two or more roles was arranged on
     *  purpose by the admin screen, and a primary change must not silently delete half of
     *  it; that is the admin screen's job, and it is Task 9. */
    CREATE TRIGGER IF NOT EXISTS user_roles_after_update
    AFTER UPDATE OF role ON users
    WHEN (SELECT COUNT(*) FROM user_roles WHERE user_id = NEW.id) <= 1
      AND EXISTS (SELECT 1 FROM user_roles WHERE user_id = NEW.id AND role = OLD.role)
    BEGIN
      UPDATE user_roles SET role = NEW.role WHERE user_id = NEW.id;
    END;
  `);

  /* Who was really driving. Nullable, no cascade: an audit row must outlive the user it
   * names, which is why `events` carries no FKs on any reference at all.
   *
   * NULL for every ordinary write, so "not an impersonation" is the DEFAULT and no caller
   * has to special-case it. The three tables are exactly the ones that already record an
   * actor — activity_log.changed_by_user_id, order_events.actor_user_id,
   * events.actor_user_id — so this is a missing column, not a missing audit system. */
  for (const t of ["activity_log", "order_events", "events"]) {
    const cols = (db.prepare("PRAGMA table_info(" + t + ")").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("impersonated_by")) {
      db.exec("ALTER TABLE " + t + " ADD COLUMN impersonated_by INTEGER REFERENCES users(id)");
    }
  }

  /* The founder is the platform owner, AND he runs طعمینو, so he holds both hats. This is
   * the one account in the app with two roles, and it is the whole reason the multi-role
   * work exists: "I am the vendor AND I am the owner of this company" is a single sentence
   * that `users.role` cannot express.
   *
   * Idempotent and keyed on the username, because the founder's id is not something a
   * migration may assume. The set is written AFTER the primary change above, so the
   * after-update trigger has already moved the row to platform_owner and this only ADDS the
   * second hat.
   *
   * The second INSERT is the load-bearing one: it is what makes `session.roles` return two
   * entries, which is what makes the picker appear for him and nothing else. */
  db.exec(`
    UPDATE users SET role = 'platform_owner' WHERE username = 'pourya';
    INSERT OR IGNORE INTO user_roles (user_id, role)
      SELECT id, 'owner' FROM users WHERE username = 'pourya';
  `);

  const nCols = (db.prepare("PRAGMA table_info(notifications)").all() as { name: string }[]).map((c) => c.name);
  if (!nCols.includes("push_flushed_at")) db.exec("ALTER TABLE notifications ADD COLUMN push_flushed_at TEXT");
  if (!nCols.includes("tg_flushed_at")) db.exec("ALTER TABLE notifications ADD COLUMN tg_flushed_at TEXT");

  seedFacilities();
  seedReasonCodes(db);
  seedCapacityFactors(db);
  seedRules(db);
  seedNotificationTypes(db);
  seedObjectionCards(db);
  seedKpiDefinitions(db);
  refreshRetiredWording(db);
  seedSeasonalFactors(db);
  seedChurnModel(db);

  // A second sweep, run last and every boot. The first one above (right after the
  // ALTER) exists so seedFacilities sees already-backfilled rows and can correctly
  // recognise them as already seeded; this one is the safety net for whatever runs
  // between here and there -- today that is seedFacilities itself, and the point of
  // running this every boot is that it stays correct for whatever gets added later
  // without anyone having to remember to update this comment.
  for (const table of TENANT_TABLES) {
    // reason_codes is the one exception: a NULL organization_id there is deliberate --
    // it marks a system-default row every tenant shares -- not a row that missed the
    // tenancy backfill.
    if (
      table === "reason_codes" ||
      table === "capacity_factors" ||
      table === "rules" ||
      table === "notification_types" ||
      table === "objection_cards" ||
      table === "kpi_definitions" ||
      table === "seasonal_factors" ||
      table === "churn_models"
    )
      continue;
    db.exec(`UPDATE ${table} SET organization_id = 1 WHERE organization_id IS NULL`);
  }

  // Seed the chart of accounts before any ledger backfill can need an account id. Not
  // guarded on an app_meta marker: seedAccounts is itself idempotent by code, so running it
  // on every boot is what guarantees a row added to the chart in a later release reaches
  // every database, including one that booted a hundred times before that release.
  seedAccounts(db);

  // purchases gains supplier_id and the legacy free-text supplier becomes real rows. Must
  // run AFTER the suppliers table exists (schema block above) and BEFORE any purchase is
  // recorded, so a receipt recorded on a fresh database already has a supplier_id.
  migratePurchaseSuppliers(db);

  // Turn existing payments into ledger postings. After seedAccounts (it needs account
  // ids) and BEFORE any live payment path can write, so the cutover in Task 4 never races
  // the history it is supposed to sit on top of.
  backfillLedger(db);

  // Phase 2: convert legacy purchases + deliveries into the stock-movement ledger, once.
  backfillStockLedger(db);

  // Phase 3: give every legacy order a synthetic 'create' event so its timeline is not
  // blank. After backfillStockLedger so a fresh boot has done all its table rebuilds.
  backfillOrderEvents(db);

  // Phase 5 (Routing): delivery_runs gains the planning + optimisation record. Plain ADD
  // COLUMN, guarded per column.
  const drCols = (db.prepare("PRAGMA table_info(delivery_runs)").all() as { name: string }[]).map(
    (c) => c.name
  );
  const drAdds: [string, string][] = [
    ["vehicle_id", "INTEGER REFERENCES vehicles(id)"],
    ["route_template_id", "INTEGER REFERENCES route_templates(id)"],
    ["planned_distance_km", "REAL"],
    ["actual_distance_km", "REAL"],
    ["planned_duration_min", "INTEGER"],
    ["actual_duration_min", "INTEGER"],
    ["capacity_stops", "INTEGER"],
    ["weather_json", "TEXT"],
    ["optimisation_json", "TEXT"],
    ["frozen_at", "TEXT"],
  ];
  for (const [col, type] of drAdds) {
    if (!drCols.includes(col)) db.exec(`ALTER TABLE delivery_runs ADD COLUMN ${col} ${type}`);
  }

  /* Phase 8: a van holds stock, so a vehicle needs to point at the facility where its stock
   * lives. Nullable on purpose — a vehicle with no facility simply has no stock of its own and
   * everything it delivers comes off the depot, which is how the app behaved before this phase
   * and has to keep working. */
  const vehCols = (db.prepare("PRAGMA table_info(vehicles)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!vehCols.includes("facility_id")) {
    db.exec("ALTER TABLE vehicles ADD COLUMN facility_id INTEGER REFERENCES facilities(id)");
  }
  // A 'ready' status between 'planned' and 'in_progress' -- the run is frozen but the
  // driver has not started. CHECK change -> a guarded rebuild.
  //
  // Runs AFTER foldLeadRunsIntoDeliveryRuns (called ~380 lines earlier, ahead of the pin
  // fold): the fold inserts into delivery_runs, so this rebuild must not be about to replace
  // the table those rows just landed in.
  rebuildDeliveryRunsStatus(db);

  // Phase 1 (mixed-route planning): the day a customer asked an order to be delivered on.
  //
  // NULL here is NOT "unset" and it is NOT a boolean -- it IS «در اولین فرصت», the state
  // that says nobody has committed this order to a day yet. That is the whole reason there is
  // no `is_asap` column: a second flag would have to be kept in step with this one forever,
  // and the two would eventually disagree about which orders are urgent.
  //
  // The day-splitter's raw material is exactly the set where this is NULL, so an existing
  // database needs no backfill: every order already in it is uncommitted, which is true.
  //
  // requested_kind records WHICH control the reader used, so «هفتهٔ بعد» still reads as a week
  // after it has been resolved to a concrete date — a customer who said "next week" was not
  // told 2026-10-10.
  //
  // Both plain ADD COLUMN, guarded per column. No rebuild: neither is NOT NULL and neither
  // needs an index. The CHECK on requested_kind governs NEW rows only, which is correct --
  // every existing row is NULL and passes.
  const reqDayCols = db.prepare("PRAGMA table_info(orders)").all() as { name: string }[];
  if (!reqDayCols.some((c) => c.name === "requested_day")) {
    db.exec("ALTER TABLE orders ADD COLUMN requested_day TEXT");
  }
  if (!reqDayCols.some((c) => c.name === "requested_kind")) {
    db.exec(
      "ALTER TABLE orders ADD COLUMN requested_kind TEXT CHECK (requested_kind IN ('soonest', 'week_offset', 'exact_date'))"
    );
  }

  const prodVolCols = (db.prepare("PRAGMA table_info(products)").all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!prodVolCols.includes("volume_m3_per_base_unit")) {
    db.exec("ALTER TABLE products ADD COLUMN volume_m3_per_base_unit REAL");
  }

  // Phase 10 (Prediction): learned capacity factors sit beside the shipped/tuned ones.
  // resolvedCapacityFactorsFor uses the learned value only once learned_n >= MIN_LEARN_N,
  // so a fresh column set (learned_n = 0) leaves every Phase 6 reading unchanged.
  const cfCols = (db.prepare("PRAGMA table_info(capacity_factors)").all() as { name: string }[]).map(
    (c) => c.name
  );
  const cfAdds: [string, string][] = [
    ["learned_stop_factor", "REAL"],
    ["learned_speed_factor", "REAL"],
    ["learned_service_time_factor", "REAL"],
    ["learned_max_duration_factor", "REAL"],
    ["learned_n", "INTEGER NOT NULL DEFAULT 0"],
  ];
  for (const [col, type] of cfAdds) {
    if (!cfCols.includes(col)) db.exec(`ALTER TABLE capacity_factors ADD COLUMN ${col} ${type}`);
  }

  // Phase 4 (Offline-first): client_uuid on every offline-writable table. No CHECK, so a
  // plain ADD COLUMN + a *partial* UNIQUE index (WHERE client_uuid IS NOT NULL) -- every
  // legacy NULL row is fine and the migration is O(1) per table. UNIQUE buys idempotency
  // for free. Runs last, after every table rebuild, so nothing drops the column.
  for (const t of ["orders", "payments", "deliveries", "customers"]) {
    const cuCols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    if (!cuCols.some((c) => c.name === "client_uuid")) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN client_uuid TEXT`);
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS ix_${t}_client_uuid ON ${t}(client_uuid) WHERE client_uuid IS NOT NULL`
    );
  }

  // Board & Pocket: two nullable columns. tasks.stage is the per-kind pipeline stage
  // for the board's workflow lens -- NULL means "derive from status" (lib/tasks/lenses).
  // users.prefs_json holds { board_mobile_mode, board_default_view } -- server-side so a
  // member's board choice follows them across devices.
  const bpTaskCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!bpTaskCols.some((c) => c.name === "stage")) {
    db.exec("ALTER TABLE tasks ADD COLUMN stage TEXT");
  }
  // Phase 7 status is open|done|dismissed -- no "in progress". The Board's status lens
  // needs a middle column that works for every kind, so a task is "in progress" when
  // started_at is set and it is not yet done. Plain ADD COLUMN; status semantics for
  // listTasks / the briefing are unchanged (a started task is still status='open').
  if (!bpTaskCols.some((c) => c.name === "started_at")) {
    db.exec("ALTER TABLE tasks ADD COLUMN started_at TEXT");
  }
  const bpUserCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!bpUserCols.some((c) => c.name === "prefs_json")) {
    db.exec("ALTER TABLE users ADD COLUMN prefs_json TEXT");
  }
  // Fold existing customer reminders into the tasks spine (once, guarded).
  backfillReminderTasks(db);
  migrateCrm(db);

  _db = db;
  return db;
}

export type CoverageStatus = "visited" | "needs_coverage" | "not_allowed" | "unknown";

export interface Customer {
  id: number;
  customer_code: string;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  lifecycle: CustomerLifecycle;
  customer_type: CustomerType | null;
  parent_customer_id: number | null;
  payment_terms_days: number;
  hard_credit_block: number;
  credit_limit_toman: number | null;
  qualified_at: string | null;
  first_order_at: string | null;
  salesperson: string | null;
  opening_balance_toman: number;
  notes: string | null;
  synced_at: string;
  last_purchase_date: string | null;
}

export interface District {
  id: number;
  name: string;
  level: "mantaghe" | "mahalle";
  parent_name: string | null;
  boundary_geojson: string;
  coverage_status: CoverageStatus;
  notes: string | null;
  is_custom: number;
  /** Short speakable code, NULL for a hand-drawn district with none assigned yet. */
  code: string | null;
  /** The منطقه number as an integer, 0 when the district names no number (a بخش or a town).
   *  An integer because the two source files spell the same district differently and
   *  UNIQUE(name, level, parent_name) joins on the name. */
  parent_no: number | null;
  updated_at: string;
  /** Which group holds this territory. NULL means unclaimed -- an owner sees it, no
   *  group manager does. Replaced the free-text assigned_to column, which is retained in
   *  the table only so history written against it stays readable. */
  group_id: number | null;
  /** Area-weighted centre, filled by backfillDistrictCentroids. NULL when the geometry
   *  could not produce one -- callers must treat that as "distance unknown", never 0. */
  centroid_lat: number | null;
  centroid_lng: number | null;
}

export type EntityType = "district" | "customer";

/** visit_plans alone accepts a facility: a restock stop at the warehouse is a genuine
 *  leg of the day's route, unlike a reminder or a photo, which are always attached to a
 *  district or a customer. Kept as its own union so widening the route model does not
 *  quietly loosen every other entity reference in the schema. */
export type PlanEntityType = EntityType | "facility" | "lead" | "lead_location";
/** What activity_log accepts. Same widening as PlanEntityType, for the same reason. */
export type LoggableEntityType = PlanEntityType;
export const PLAN_ENTITY_TYPES: PlanEntityType[] = ["district", "customer", "facility", "lead", "lead_location"];

export interface ActivityEntry {
  id: number;
  entity_type: LoggableEntityType;
  entity_id: number;
  event_type: "status_change" | "note" | "assigned";
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  changed_by: string | null;
  /** The acting user's id, so history survives a rename and two people with the same
   *  display name stay distinguishable. NULL on rows written before accounts existed. */
  changed_by_user_id: number | null;
  created_at: string;
}

export interface Reminder {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  due_date: string;
  message: string;
  resolved: number;
  created_at: string;
}

export interface Photo {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  file_stem: string;
  caption: string | null;
  taken_at: string;
  created_at: string;
}

export interface VisitPlan {
  id: number;
  entity_type: PlanEntityType;
  entity_id: number;
  planned_date: string;
  status: "planned" | "done" | "skipped";
  sort_order: number;
  created_at: string;
}

export interface SaleRow {
  id: number;
  order_no: string | null;
  sale_date: string;
  customer_name: string;
  product_name: string | null;
  qty: number | null;
  amount: number;
  payment_status: string | null;
  shipping_status: string | null;
  imported_at: string;
}

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export interface ImportSnapshotRow {
  id: number;
  created_at: string;
  customers_json: string;
  sales_json: string;
}

/** Re-exported from roles.ts so server modules that already import from db.ts keep one
 *  import site, the same arrangement facilityTypes has at the top of this file. The
 *  definition itself has to live outside db.ts because client components need it and
 *  cannot import node:sqlite. */
export type { Role } from "./roles";
export { ROLES, ROLE_LABEL, ROLE_DESCRIPTION } from "./roles";

export interface GroupRow {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  active: number;
  created_at: string;
}

export interface OrganizationRow {
  id: number;
  name: string;
  slug: string;
  plan: string;
  active: number;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: Role;
  group_id: number | null;
  organization_id: number;
  staff_code: string | null;
  phone: string | null;
  active: number;
  token_version: number;
  location_consent_at: string | null;
  created_at: string;
  /** The route a person's face is served from, or null for initials. */
  avatar_url: string | null;
  /** The file stem behind that route. Separate from avatar_url so a `?key=` preset can be
   *  shown without losing the upload it is standing in for. */
  avatar_stem: string | null;
}

export type LocationResolution = "direct" | "pluscode" | "browser" | "nominatim" | "manual" | "unresolved";
export type LocationStatus = "contacted" | "visited" | "no_answer" | "declined";
export const LOCATION_STATUSES: LocationStatus[] = ["contacted", "visited", "no_answer", "declined"];

export interface SavedLocationRow {
  id: number;
  name: string;
  maps_url: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  resolution: LocationResolution;
  notes: string | null;
  status: LocationStatus | null;
  rating_potential: number | null;
  rating_volume: number | null;
  rating_ease: number | null;
  group_id: number | null;
  organization_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeadListRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

/** A list plus its membership, in order. The API always returns them together: a list
 *  without its stops is never useful to a caller, and fetching them separately would
 *  make every page do two round trips to show one thing. */
export interface LeadListWithItems extends LeadListRow {
  location_ids: number[];
}

export function readLeadLists(
  db: DatabaseSync = getDb(),
  groupIds: number[] | "all" = "all"
): LeadListWithItems[] {
  // See readCustomers: an empty scope must read as "nothing", never as "everything".
  if (groupIds !== "all" && groupIds.length === 0) return [];
  const where = groupIds === "all" ? "" : ` WHERE group_id IN (${groupIds.map(() => "?").join(", ")})`;
  const params = groupIds === "all" ? [] : groupIds;
  const lists = db
    .prepare(`SELECT id, name, created_at, updated_at FROM lead_lists${where} ORDER BY created_at`)
    .all(...params) as unknown as LeadListRow[];

  const items = db
    .prepare("SELECT list_id, location_id FROM lead_list_items ORDER BY list_id, sort_order, id")
    .all() as unknown as { list_id: number; location_id: number }[];

  const byList = new Map<number, number[]>();
  for (const it of items) {
    const arr = byList.get(it.list_id);
    if (arr) arr.push(it.location_id);
    else byList.set(it.list_id, [it.location_id]);
  }

  // Rebuilt as object literals rather than passed through: node:sqlite hands back
  // null-prototype rows, which cannot cross into a Client Component.
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    created_at: l.created_at,
    updated_at: l.updated_at,
    location_ids: byList.get(l.id) ?? [],
  }));
}

/** Replaces a list's membership wholesale.
 *
 *  A whole-list write rather than add/remove/reorder endpoints: the order is the point,
 *  every edit changes it, and three endpoints that each have to renumber the others is
 *  three chances to leave the list inconsistent. One statement, one transaction, one
 *  possible outcome.
 */
export function setLeadListItems(db: DatabaseSync, listId: number, locationIds: number[]): void {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM lead_list_items WHERE list_id = ?").run(listId);
    const insert = db.prepare(
      "INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (?, ?, ?, ?)"
    );
    locationIds.forEach((locationId, i) => insert.run(listId, locationId, i, now));
    db.prepare("UPDATE lead_lists SET updated_at = ? WHERE id = ?").run(now, listId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function logActivity(
  db: DatabaseSync,
  entry: Omit<ActivityEntry, "id" | "created_at" | "changed_by_user_id"> & {
    changed_by_user_id?: number | null;
    /** Who was really driving, when this happened under Login-As. */
    impersonated_by?: number | null;
  }
): void {
  db.prepare(
    `INSERT INTO activity_log (entity_type, entity_id, event_type, old_value, new_value, note, changed_by, changed_by_user_id, impersonated_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.entity_type,
    entry.entity_id,
    entry.event_type,
    entry.old_value,
    entry.new_value,
    entry.note,
    entry.changed_by,
    entry.changed_by_user_id ?? null,
    entry.impersonated_by ?? null,
    new Date().toISOString()
  );
}

// The two sites the business started from, recovered from the Google Maps links they
// shared: the warehouse link was a place record (املاک طاها) whose coordinates came out
// of Google's own place data, the home link carried an explicit dropped pin.
//
// Seeded rather than hard-coded so the user can edit them, and keyed on `slug` so that
// re-running this -- which happens on every boot, and again after any backup restore --
// neither duplicates a row nor reverts an edit. INSERT OR IGNORE, deliberately not
// INSERT OR REPLACE: REPLACE would silently throw away a repositioned pin on the next
// deploy, which is the exact failure this table exists to prevent.
/** GONE, deliberately: the two facilities this used to insert.
 *
 *  They were the one real company's warehouse and home base, written here by address, with
 *  organization_id pinned to 1 because the app only had one company when they were added.
 *  That is the whole problem in miniature -- a specific business's addresses compiled into
 *  a schema bootstrap, so every tenant that ever ran this got them, and every distance in
 *  the app was measured from a house in Pardis whether or not that was the reader's house.
 *
 *  Every place is now made by a person, through the app. A fresh database has no
 *  facilities at all, which is the honest starting state: the first thing you are asked
 *  is where your warehouse is. Nothing here is invented, so nothing here has to be
 *  migrated when a second tenant arrives.
 *
 *  The remaining seeds in this file are a different category on purpose -- reason codes,
 *  capacity factors, KPI definitions -- all of them system-wide defaults carrying
 *  organization_id NULL, with a tenant free to override. A business's own address is not
 *  a default; it is data. */

export function seedFacilities(): void {
  // Kept as a named no-op so the call site at the bottom of this file, and any external
  // caller of the export, stay valid. Delete it and every caller once they are gone.
}

/** Phase 3: the system-default reason codes every tenant sees (organization_id NULL).
 *  A tenant may add its own rows on top. `INSERT ... SELECT ... WHERE NOT EXISTS` per
 *  row rather than `INSERT OR IGNORE`, because the UNIQUE is on
 *  (organization_id, domain, code) and NULL != NULL under SQLite, so OR IGNORE would
 *  re-insert every boot. */
export const REASON_CODE_SEED: { domain: string; code: string; label_fa: string }[] = [
  { domain: "delivery_fail", code: "CUSTOMER_ABSENT", label_fa: "مشتری در محل نبود" },
  { domain: "delivery_fail", code: "CUSTOMER_REFUSED", label_fa: "مشتری تحویل نگرفت" },
  { domain: "delivery_fail", code: "ADDRESS_NOT_FOUND", label_fa: "آدرس پیدا نشد" },
  { domain: "delivery_fail", code: "SHOP_CLOSED", label_fa: "مغازه تعطیل بود" },
  { domain: "delivery_fail", code: "PAYMENT_DISPUTE", label_fa: "اختلاف بر سر مبلغ" },
  { domain: "delivery_delay", code: "TRAFFIC", label_fa: "ترافیک سنگین" },
  { domain: "delivery_delay", code: "VEHICLE_ISSUE", label_fa: "مشکل خودرو" },
  { domain: "delivery_delay", code: "WEATHER", label_fa: "شرایط جوی" },
  { domain: "order_cancel", code: "CUSTOMER_CANCELLED", label_fa: "مشتری لغو کرد" },
  { domain: "order_cancel", code: "DUPLICATE", label_fa: "سفارش تکراری" },
  { domain: "order_cancel", code: "STOCK_SHORTAGE", label_fa: "نبود موجودی" },
  { domain: "order_return", code: "QUALITY_ISSUE", label_fa: "مشکل کیفی کالا" },
  { domain: "order_return", code: "WRONG_ITEM", label_fa: "کالای اشتباه" },
];

/** Phase 6: the six §4.1 conditions with their measured capacity effect, as NULL-org
 *  defaults. INSERT ... WHERE NOT EXISTS per row (NULL != NULL under SQLite's UNIQUE, so
 *  OR IGNORE would re-insert). A tenant overrides by writing its own (org, code) row. */
export const CAPACITY_FACTOR_SEED: {
  code: string;
  stop: number;
  service: number;
  speed: number;
  duration: number;
  note: string;
}[] = [
  { code: "heavy_rain", stop: 0.8, service: 1.2, speed: 0.85, duration: 1, note: "باران شدید — پارک و تحویل کندتر" },
  { code: "snow_ice", stop: 0.55, service: 1.3, speed: 0.6, duration: 1, note: "برف و یخ‌بندان" },
  { code: "extreme_heat", stop: 0.85, service: 1.15, speed: 1, duration: 0.7, note: "گرمای شدید — سقف زمان مسیر برای زنجیرهٔ سرد" },
  { code: "high_wind", stop: 0.85, service: 1.1, speed: 0.9, duration: 1, note: "باد شدید" },
  { code: "dust_storm", stop: 0.7, service: 1.1, speed: 0.7, duration: 1, note: "گرد و خاک — دید کم" },
  { code: "fog", stop: 0.8, service: 1.05, speed: 0.75, duration: 1, note: "مه — دید کم" },
];

/** Phase 7: a handful of NULL-org default rules. INSERT ... WHERE NOT EXISTS per row
 *  (NULL != NULL under SQLite's UNIQUE). A tenant overrides by writing its own
 *  (org, code) row. */
export const RULE_SEED: {
  code: string;
  name: string;
  trigger_kind: string;
  condition_json: string | null;
  action_kind: string;
  action_json: string;
  cooldown_min: number;
  escalate_after_min: number | null;
  escalate_to_role: string | null;
}[] = [
  {
    code: "credit_approval_waiting",
    name: "درخواست اعتبار معطل",
    trigger_kind: "sweep",
    condition_json: null,
    action_kind: "alert",
    action_json: JSON.stringify({ severity: "critical", category: "credit", title: "درخواست اعتبار در انتظار تصمیم" }),
    cooldown_min: 60,
    escalate_after_min: 240,
    escalate_to_role: "owner",
  },
  {
    code: "delivery_failed_retry",
    name: "تحویل ناموفق — پیگیری",
    trigger_kind: "delivery.failed",
    condition_json: null,
    action_kind: "task",
    action_json: JSON.stringify({ role_hint: "group_manager", priority: "HIGH", title: "پیگیری تحویل ناموفق", kind: "delivery_retry" }),
    cooldown_min: 720,
    escalate_after_min: null,
    escalate_to_role: null,
  },
  {
    code: "customer_overdue",
    name: "مشتری معوق",
    trigger_kind: "sweep",
    condition_json: null,
    action_kind: "task",
    action_json: JSON.stringify({ role_hint: "phone_sales", priority: "NORMAL", title: "تماس با مشتری معوق", kind: "call" }),
    cooldown_min: 2880,
    escalate_after_min: null,
    escalate_to_role: null,
  },
  {
    code: "expiring_batch",
    name: "سری ساخت رو به انقضا",
    trigger_kind: "sweep",
    condition_json: null,
    action_kind: "alert",
    action_json: JSON.stringify({ severity: "warning", category: "stock", title: "سری ساخت رو به انقضا با موجودی" }),
    cooldown_min: 1440,
    escalate_after_min: null,
    escalate_to_role: null,
  },
  {
    code: "sample_followup",
    name: "پیگیری نمونه",
    trigger_kind: "sweep",
    condition_json: null,
    action_kind: "task",
    action_json: JSON.stringify({ role_hint: "phone_sales", priority: "NORMAL", title: "پیگیری نمونه", kind: "sample_followup" }),
    cooldown_min: 4320,
    escalate_after_min: null,
    escalate_to_role: null,
  },

  // Phase 1 notifications: one `notify` rule per event kind that should reach a person's
  // feed. action_json.notification_type names the row in NOTIFICATION_TYPE_SEED; recipient
  // resolution lives in lib/repo/notifications.recipientsFor. cooldown_min: 1 so a genuine
  // duplicate within the same minute is still absorbed while the feed is not throttled.
  { code: "notify_task_assigned",          name: "اعلان: کار سپرده‌شده",   trigger_kind: "task.assigned",       condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "task.assigned" }),      cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_confirmed",        name: "اعلان: تأیید سفارش",      trigger_kind: "order.passReview",     condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.confirmed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_confirmed_credit", name: "اعلان: تأیید سفارش (اعتبار)", trigger_kind: "order.approveCredit", condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.confirmed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_rejected",         name: "اعلان: لغو سفارش",        trigger_kind: "order.cancel",         condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.rejected" }),      cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_order_created",          name: "اعلان: سفارش جدید",       trigger_kind: "order.submit",         condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "order.created" }),       cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_delivery_succeeded",     name: "اعلان: تحویل موفق",      trigger_kind: "delivery.succeeded",   condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "delivery.succeeded" }),  cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_delivery_failed",        name: "اعلان: تحویل ناموفق",    trigger_kind: "delivery.failed",      condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "delivery.failed" }),     cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_payment_recorded",       name: "اعلان: ثبت پرداخت",       trigger_kind: "payment.recorded",     condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "payment.recorded" }),    cooldown_min: 1, escalate_after_min: null, escalate_to_role: null },

  // Phase 2 loud-channel rules. notify_task_escalated fires through runEventRules on the
  // task.escalated event; the other four are trigger_kind 'sweep' -- a later task adds
  // consider("<code>", ...) calls in runSweepRules, and consider() only fires 'sweep'
  // rules. Longer cooldowns on the sweep-fed rules because a sweep re-evaluates the same
  // overdue customer / due cheque every tick; liveRun dedupe + this cooldown keep it to
  // one notification per entity per day.
  { code: "notify_task_escalated",          name: "اعلان: ارجاع کار",         trigger_kind: "task.escalated", condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "task.escalated" }),          cooldown_min: 1,    escalate_after_min: null, escalate_to_role: null },
  { code: "notify_credit_approval_waiting", name: "اعلان: انتظار تأیید اعتبار", trigger_kind: "sweep",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "credit_approval.waiting" }), cooldown_min: 60,   escalate_after_min: null, escalate_to_role: null },
  { code: "notify_customer_overdue",        name: "اعلان: مشتری عقب‌افتاده",   trigger_kind: "sweep",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "customer.overdue" }),        cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_cheque_due_soon",         name: "اعلان: سررسید چک",         trigger_kind: "sweep",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "cheque.due_soon" }),         cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
  { code: "notify_reminder_due",            name: "اعلان: یادآوری",           trigger_kind: "sweep",          condition_json: null, action_kind: "notify", action_json: JSON.stringify({ notification_type: "reminder.due" }),            cooldown_min: 1440, escalate_after_min: null, escalate_to_role: null },
];

export function seedRules(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO rules
       (organization_id, code, name, trigger_kind, condition_json, action_kind, action_json,
        cooldown_min, escalate_after_min, escalate_to_role, active, created_at, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM rules WHERE organization_id IS NULL AND code = ?)`
  );
  for (const r of RULE_SEED) {
    insert.run(
      r.code,
      r.name,
      r.trigger_kind,
      r.condition_json,
      r.action_kind,
      r.action_json,
      r.cooldown_min,
      r.escalate_after_min,
      r.escalate_to_role,
      now,
      now,
      r.code
    );
  }
}

export interface NotificationTypeSeed {
  code: string;
  name_fa: string;
  category: string;
  directedness: "directed" | "ambient";
  priority: "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
  group_scope: "entity" | "type_day";
}

const PRIORITY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

/** The spec's loud-by-default rule, stored on each catalogue row for the settings hint.
 *  A directed notification (aimed at one person) goes loud from NORMAL up; an ambient one
 *  (a group feed item) only goes loud at CRITICAL. */
export function loudByDefault(directedness: string, priority: string): 0 | 1 {
  if (directedness === "directed") return PRIORITY_RANK[priority] >= PRIORITY_RANK.NORMAL ? 1 : 0;
  return priority === "CRITICAL" ? 1 : 0;
}

/** The Phase 1 catalogue, NULL-org, plus the Phase 2 loud-channel additions. Same
 *  INSERT ... WHERE NOT EXISTS treatment as RULE_SEED / OBJECTION_CARD_SEED. Recipient
 *  wiring lives in lib/repo/notifications.ts; default_push / default_telegram are derived
 *  from loudByDefault(directedness, priority) at seed time, not stored on the literal. */
export const NOTIFICATION_TYPE_SEED: NotificationTypeSeed[] = [
  { code: "task.assigned",      name_fa: "کاری به شما سپرده شد",      category: "task",     directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "order.confirmed",    name_fa: "سفارش شما تأیید شد",         category: "order",    directedness: "directed", priority: "NORMAL", group_scope: "entity" },
  { code: "order.rejected",     name_fa: "سفارش شما رد/لغو شد",        category: "order",    directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "order.created",      name_fa: "سفارش جدید در گروه",         category: "order",    directedness: "ambient",  priority: "NORMAL", group_scope: "type_day" },
  { code: "delivery.succeeded", name_fa: "تحویل موفق",                 category: "delivery", directedness: "directed", priority: "NORMAL", group_scope: "type_day" },
  { code: "delivery.failed",    name_fa: "تحویل ناموفق",              category: "delivery", directedness: "directed", priority: "HIGH",   group_scope: "entity" },
  { code: "payment.recorded",   name_fa: "پرداخت روی سفارش شما ثبت شد", category: "finance",  directedness: "directed", priority: "NORMAL", group_scope: "entity" },
  { code: "task.escalated",          name_fa: "کار به شما ارجاع شد",        category: "task",     directedness: "directed", priority: "CRITICAL", group_scope: "entity" },
  { code: "credit_approval.waiting", name_fa: "تأیید اعتبار در انتظار شماست", category: "finance",  directedness: "directed", priority: "HIGH",     group_scope: "entity" },
  { code: "customer.overdue",        name_fa: "مشتری شما عقب‌افتاده است",     category: "customer", directedness: "directed", priority: "NORMAL",   group_scope: "entity" },
  { code: "cheque.due_soon",         name_fa: "سررسید چک نزدیک است",         category: "finance",  directedness: "directed", priority: "HIGH",     group_scope: "entity" },
  { code: "reminder.due",            name_fa: "یادآوری سررسید",              category: "task",     directedness: "directed", priority: "NORMAL",   group_scope: "type_day" },
  { code: "system.test",             name_fa: "پیام آزمایشی",                category: "task",     directedness: "directed", priority: "NORMAL",   group_scope: "entity" },
];

export function seedNotificationTypes(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO notification_types
       (organization_id, code, name_fa, category, directedness, priority, group_scope,
        default_push, default_telegram, active, created_at, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM notification_types WHERE organization_id IS NULL AND code = ?)`
  );
  // Phase 2 backfill: the NULL-org catalogue rows are shipped defaults (tenants override
  // with their own rows), so force default_push / default_telegram to the canonical
  // loudByDefault value on every boot. This catches the 6 Phase-1 rows that predate the
  // columns and would otherwise keep the ALTER's DEFAULT 0; on a fresh DB it is a no-op
  // right after the INSERT. organization_id IS NOT NULL rows are never touched.
  const backfill = db.prepare(
    `UPDATE notification_types SET default_push = ?, default_telegram = ?, updated_at = ?
      WHERE organization_id IS NULL AND code = ?`
  );
  for (const t of NOTIFICATION_TYPE_SEED) {
    const loud = loudByDefault(t.directedness, t.priority);
    insert.run(t.code, t.name_fa, t.category, t.directedness, t.priority, t.group_scope, loud, loud, now, now, t.code);
    backfill.run(loud, loud, now, t.code);
  }
}

/** Phase 8: starter objection cards, NULL-org. Keyed to the outcome codes the /today
 *  TaskRow emits plus a few classics. INSERT ... WHERE NOT EXISTS per row. */
export const OBJECTION_CARD_SEED: {
  outcome_code: string;
  title_fa: string;
  script_fa: string;
  module_slug: string;
}[] = [
  { outcome_code: "PRICE_OBJECTION", title_fa: "«گران است»", script_fa: "قیمت را به مصرف هر پرس برگردانید: «کره در هر پرس حدود X تومان می‌شود؛ تفاوتش با مارک ارزان‌تر در ماه Y تومان است، اما برگشتی و شکایت مشتری شما را کم می‌کند.» بعد یک نمونهٔ رایگان پیشنهاد دهید.", module_slug: "02-phone-sales" },
  { outcome_code: "NOT_INTERESTED", title_fa: "«علاقه‌ای ندارم»", script_fa: "روی زمان‌بندی کار کنید، نه محصول: «کاملاً درست است، الان وقت خوبی نیست. اجازه بدهید فقط یک نمونه بگذارم و هفتهٔ بعد اگر خواستید یک تماس کوتاه بگیریم.» فشار نیاورید؛ در دفترچه یادداشت کنید و در بازهٔ بعدی برگردید.", module_slug: "01-market-and-customer" },
  { outcome_code: "NO_TIME", title_fa: "«الان وقت ندارم»", script_fa: "«حتماً، ۳۰ ثانیه بیشتر نمی‌گیرم — فقط می‌خواستم بگویم این هفته نمونهٔ کره داریم؛ کی برای‌تان بیاورم، امروز یا فردا؟» یک انتخاب دوگزینه‌ای بدهید.", module_slug: "02-phone-sales" },
  { outcome_code: "ALREADY_SUPPLIED", title_fa: "«تأمین‌کننده دارم»", script_fa: "«عالی است که یک تأمین‌کنندهٔ ثابت دارید. بیشتر مشتری‌های ما هم دارند و ما را برای روزهایی نگه می‌دارند که آن‌ها جنس ندارند یا دیر می‌رسانند. یک نمونه بگذارم که مقایسه دستتان باشد؟»", module_slug: "01-market-and-customer" },
  { outcome_code: "QUALITY_DOUBT", title_fa: "«کیفیتش را نمی‌شناسم»", script_fa: "روی قابلیت ردیابی تکیه کنید: «هر سری ساخت ما تاریخ تولید و انقضا دارد و ما دقیقاً می‌دانیم هر جعبه به کدام مغازه رفته. یک نمونه بگذارم، خودتان روی یک غذا امتحان کنید.»", module_slug: "01-market-and-customer" },
  { outcome_code: "PAYMENT_TERMS", title_fa: "«نقدی نمی‌خرم»", script_fa: "«مشکلی نیست، برای مشتری‌های ثابت مهلت تسویه داریم. سفارش اول را نقد بگیریم که آشنا شویم، از سفارش دوم روی چک یا مهلت هفتگی می‌رویم.»", module_slug: "02-phone-sales" },
  { outcome_code: "CONTACTED", title_fa: "پیگیری تماس بی‌نتیجه", script_fa: "یک تماس بدون سفارش، شکست نیست. تاریخ تماس بعدی را همین حالا در دفترچه بگذارید (۳ تا ۷ روز)، و یک بهانهٔ تماس تازه آماده کنید: نمونهٔ جدید، تخفیف مناسبتی، یا محصول تازه.", module_slug: "02-phone-sales" },
  { outcome_code: "ORDERED", title_fa: "بعد از اولین خرید", script_fa: "روز تحویل یک تماس کوتاه بگیرید: «کره به دستتان رسید؟ راضی بودید؟» و بازهٔ سفارش بعدی را پیشنهاد بدهید. اولین خرید تازه شروع رابطه است.", module_slug: "01-market-and-customer" },
];

export function seedObjectionCards(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO objection_cards
       (organization_id, outcome_code, customer_type, title_fa, script_fa, module_slug, active, updated_at)
     SELECT NULL, ?, NULL, ?, ?, ?, 1, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM objection_cards
         WHERE organization_id IS NULL AND outcome_code = ? AND customer_type IS NULL
      )`
  );
  for (const c of OBJECTION_CARD_SEED) {
    insert.run(c.outcome_code, c.title_fa, c.script_fa, c.module_slug, now, c.outcome_code);
  }
}

/** Phase 9: the Tier-1 KPI registry, NULL-org. One row per metric in
 *  lib/analysis/metrics.METRICS, each carrying the seven attributes the source (§6)
 *  says a KPI needs to be a management figure rather than a report. INSERT ... WHERE
 *  NOT EXISTS per row, the reason_codes treatment. */
export const KPI_DEFINITION_SEED: {
  metric: string;
  title_fa: string;
  definition_fa: string;
  formula_fa: string;
  owner_role: string;
  benchmark_fa: string;
  frequency: "daily" | "weekly" | "monthly";
  action_fa: string;
  tier: number;
  direction: "up" | "down";
}[] = [
  {
    metric: "net_sales",
    title_fa: "فروش خالص",
    definition_fa: "ارزش کالای تحویل‌شده در دورهٔ جاری، به قیمت فروش ثبت‌شده روی سطر سفارش، پس از کسر برگشتی.",
    formula_fa: "Σ (تعداد تحویل‌شدهٔ هر سطر × قیمت واحد آن سطر) روی سفارش‌های تحویل‌شده",
    owner_role: "group_manager",
    benchmark_fa: "رشد ماهانهٔ ۵٪ تا ۱۰٪ در سال اول",
    frequency: "daily",
    action_fa: "اگر زیر هدف است، دکمهٔ «چرا؟» را بزنید و افت را تا سطح فروشنده و مرحلهٔ قیف دنبال کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "gross_profit",
    title_fa: "سود ناخالص",
    definition_fa: "فروش خالص منهای بهای تمام‌شدهٔ کالای همان سفارش‌ها (از قیمت خرید سری ساخت).",
    formula_fa: "فروش خالص − Σ (تعداد تحویل‌شده × بهای واحد سری ساخت)",
    owner_role: "owner",
    benchmark_fa: "متناسب با حاشیهٔ هدف؛ نباید کندتر از فروش رشد کند",
    frequency: "weekly",
    action_fa: "اگر فروش بالا می‌رود ولی سود نه، ترکیب فروش کالاها و تخفیف‌ها را در بخش «حاشیهٔ مشارکتی» بررسی کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "gross_margin",
    title_fa: "حاشیهٔ سود ناخالص",
    definition_fa: "سهم سود ناخالص از فروش خالص، به‌صورت درصد.",
    formula_fa: "سود ناخالص ÷ فروش خالص",
    owner_role: "owner",
    benchmark_fa: "۱۸٪ تا ۲۵٪ برای توزیع کره",
    frequency: "weekly",
    action_fa: "افت حاشیه یعنی تخفیف زیاد یا رشد فروش کالای کم‌سود؛ سیاست قیمت و سبد فروشنده را مرور کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "orders",
    title_fa: "تعداد سفارش",
    definition_fa: "شمار سفارش‌هایی که در دوره به وضعیت تحویل‌شده رسیده‌اند.",
    formula_fa: "COUNT(سفارش‌های تحویل‌شده در دوره)",
    owner_role: "group_manager",
    benchmark_fa: "روند صعودی هم‌راستا با تعداد مشتری فعال",
    frequency: "daily",
    action_fa: "افت هم‌زمان با فروش یعنی مشکل تقاضا؛ افت بدون افت فروش یعنی سفارش‌ها بزرگ‌تر شده‌اند.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "aov",
    title_fa: "میانگین ارزش سفارش",
    definition_fa: "فروش خالص دوره تقسیم بر تعداد سفارش تحویل‌شدهٔ همان دوره.",
    formula_fa: "فروش خالص ÷ تعداد سفارش",
    owner_role: "group_manager",
    benchmark_fa: "رشد آرام از طریق فروش مکمل، نه تخفیف حجمی",
    frequency: "weekly",
    action_fa: "برای رشد، فروش مکمل (کارت فرصت در مرکز اقدام) را روی مشتری‌های تک‌کالا اجرا کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "active_customers",
    title_fa: "مشتری فعال",
    definition_fa: "مشتری‌ای که در ۶۰ روز گذشته دست‌کم یک سفارش تأییدشده داشته است (تعریف واژه‌نامهٔ داده).",
    formula_fa: "COUNT(مشتری با ≥۱ سفارش تأییدشده در ۶۰ روز اخیر)",
    owner_role: "group_manager",
    benchmark_fa: "بیش از ۷۰٪ کل مشتری‌های ثبت‌شدهٔ منطقه",
    frequency: "weekly",
    action_fa: "ریزش این عدد را با فهرست «مشتری در خطر» در مرکز اقدام تطبیق دهید و تماس بگیرید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "new_customers",
    title_fa: "مشتری جدید",
    definition_fa: "مشتری‌ای که اولین سفارش تاریخ‌اش (نه اولین سفارش در بازهٔ گزارش) در این دوره است.",
    formula_fa: "COUNT(مشتری با MIN(تاریخ سفارش) داخل دوره)",
    owner_role: "phone_sales",
    benchmark_fa: "متناسب با تعداد نمونهٔ گذاشته‌شده و نرخ تبدیل نمونه",
    frequency: "monthly",
    action_fa: "اگر کم است، تعداد نمونهٔ فعال و پیگیری نمونه را بررسی کنید؛ ورودی قیف مشکل دارد.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "lost_customers",
    title_fa: "مشتری از‌دست‌رفته",
    definition_fa: "مشتری‌ای که ابتدای دوره فعال بوده و تا پایان دوره ۶۰ روز بدون سفارش مانده است.",
    formula_fa: "COUNT(فعال در ابتدای دوره ∧ بدون سفارش در ۶۰ روز منتهی به پایان دوره)",
    owner_role: "group_manager",
    benchmark_fa: "کمتر از ۵٪ پایگاه مشتری در ماه",
    frequency: "monthly",
    action_fa: "هر مورد را به‌عنوان یک کار تماس به فروشندهٔ همان مشتری بسپارید و علت را در کد نتیجه ثبت کنید.",
    tier: 1,
    direction: "down",
  },
  {
    metric: "repeat_rate",
    title_fa: "نرخ خرید تکرارشونده",
    definition_fa: "سهم مشتری‌هایی که در دوره دست‌کم دو سفارش داشته‌اند از مشتری‌هایی که دست‌کم یک سفارش داشته‌اند.",
    formula_fa: "COUNT(مشتری با ≥۲ سفارش در دوره) ÷ COUNT(مشتری با ≥۱ سفارش در دوره)",
    owner_role: "phone_sales",
    benchmark_fa: "بیش از ۶۰٪ برای کالای مصرفی پرگردش",
    frequency: "monthly",
    action_fa: "نرخ پایین یعنی مشکل کیفیت یا پیگیری؛ تماس روز تحویل و بازهٔ سفارش بعدی را جدی بگیرید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "collection_rate",
    title_fa: "نرخ وصول",
    definition_fa: "نسبت مبلغ دریافت‌شده در دوره به ارزش کالای تحویل‌شدهٔ همان دوره.",
    formula_fa: "Σ دریافت‌های دوره ÷ فروش خالص دوره",
    owner_role: "owner",
    benchmark_fa: "بالای ۹۰٪؛ زیر ۸۰٪ یعنی خطر نقدینگی",
    frequency: "weekly",
    action_fa: "با فهرست «مطالبات معوق» مرکز اقدام شروع کنید و چک‌های سررسیدشده را پیگیری کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "overdue_receivables",
    title_fa: "مطالبات معوق",
    definition_fa: "جمع بدهی مشتریان که بیش از ۳۰ روز از تحویل سفارش پرداخت‌نشده مانده است، در پایان دوره.",
    formula_fa: "Σ بدهی مشتری در سطل «بیش از ۳۰ روز»",
    owner_role: "owner",
    benchmark_fa: "کمتر از ۱۰٪ کل مطالبات باز",
    frequency: "weekly",
    action_fa: "سقف اعتبار مشتری‌های بدحساب را ببندید و تا تسویه، سفارش نقدی کنید.",
    tier: 1,
    direction: "down",
  },
  {
    metric: "on_time_delivery",
    title_fa: "تحویل به‌موقع",
    definition_fa: "سهم سفارش‌هایی که در تاریخ برنامه‌ریزی‌شده یا زودتر تحویل شده‌اند از کل سفارش‌های تحویل‌شده.",
    formula_fa: "COUNT(تاریخ تحویل ≤ تاریخ برنامه) ÷ COUNT(تحویل‌شده)",
    owner_role: "group_manager",
    benchmark_fa: "بالای ۹۵٪",
    frequency: "daily",
    action_fa: "افت را با «امتیاز راننده» و شرایط جوی مسیر تطبیق دهید؛ ظرفیت مسیر را بازبینی کنید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "fulfillment_rate",
    title_fa: "نرخ تکمیل سفارش",
    definition_fa: "سهم تعداد تحویل‌شده از تعداد سفارش‌داده‌شده، روی سفارش‌هایی که به مرحلهٔ قیمت‌گذاری رسیده‌اند.",
    formula_fa: "Σ تعداد تحویل‌شدهٔ سطرها ÷ Σ تعداد سفارش‌دادهٔ سطرها",
    owner_role: "group_manager",
    benchmark_fa: "بالای ۹۸٪ برای کالای موجود",
    frequency: "daily",
    action_fa: "کسری مکرر یعنی مشکل موجودی یا بارگیری؛ هشدار کمبود موجودی و نرخ پرشدن راننده را ببینید.",
    tier: 1,
    direction: "up",
  },
  {
    metric: "sample_conversion",
    title_fa: "نرخ تبدیل نمونه",
    definition_fa: "سهم سفارش‌های نمونه که ظرف ۳۰ روز یک سفارش عادی از همان مشتری به دنبال داشته‌اند.",
    formula_fa: "COUNT(نمونه با سفارش عادی بعدی ظرف ۳۰ روز) ÷ COUNT(سفارش نمونه)",
    owner_role: "phone_sales",
    benchmark_fa: "بالای ۳۰٪",
    frequency: "monthly",
    action_fa: "نرخ پایین یعنی پیگیری نمونه ضعیف است؛ کار «پیگیری نمونه» را سر وقت ببندید و کارت اعتراض را بخوانید.",
    tier: 1,
    direction: "up",
  },
];

export function seedKpiDefinitions(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO kpi_definitions
       (organization_id, metric, title_fa, definition_fa, formula_fa, owner_role,
        benchmark_fa, frequency, action_fa, tier, direction, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM kpi_definitions WHERE organization_id IS NULL AND metric = ?
      )`
  );
  for (const d of KPI_DEFINITION_SEED) {
    insert.run(
      d.metric,
      d.title_fa,
      d.definition_fa,
      d.formula_fa,
      d.owner_role,
      d.benchmark_fa,
      d.frequency,
      d.action_fa,
      d.tier,
      d.direction,
      now,
      d.metric
    );
  }
}

/** Phase 10: the shipped season shape — a mild guess, mean-normalised to ~1 across
 *  each cycle. The whole point of the cold-start rule is that a brand-new tenant
 *  forecasts off this until it has a year of its own months. 12 Jalali-month factors
 *  (Farvardin=1 … a Nowruz lift, an Esfand run-up, a mid-summer dip) + 7 day-of-week
 *  factors (Saturday=0, a Thursday/Friday drop for a wholesale week). */
export const SEASONAL_FACTOR_SEED: { kind: "month" | "dow"; idx: number; factor: number }[] = [
  { kind: "month", idx: 1, factor: 1.12 },
  { kind: "month", idx: 2, factor: 1.05 },
  { kind: "month", idx: 3, factor: 1.0 },
  { kind: "month", idx: 4, factor: 0.95 },
  { kind: "month", idx: 5, factor: 0.9 },
  { kind: "month", idx: 6, factor: 0.9 },
  { kind: "month", idx: 7, factor: 0.95 },
  { kind: "month", idx: 8, factor: 1.0 },
  { kind: "month", idx: 9, factor: 1.03 },
  { kind: "month", idx: 10, factor: 1.03 },
  { kind: "month", idx: 11, factor: 1.07 },
  { kind: "month", idx: 12, factor: 1.0 },
  { kind: "dow", idx: 0, factor: 1.15 }, // Saturday — week opens
  { kind: "dow", idx: 1, factor: 1.15 }, // Sunday
  { kind: "dow", idx: 2, factor: 1.1 }, // Monday
  { kind: "dow", idx: 3, factor: 1.05 }, // Tuesday
  { kind: "dow", idx: 4, factor: 1.0 }, // Wednesday
  { kind: "dow", idx: 5, factor: 0.75 }, // Thursday
  { kind: "dow", idx: 6, factor: 0.6 }, // Friday — mostly closed
];

export function seedSeasonalFactors(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO seasonal_factors (organization_id, kind, idx, factor, updated_at)
     SELECT NULL, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM seasonal_factors WHERE organization_id IS NULL AND kind = ? AND idx = ?
      )`
  );
  for (const r of SEASONAL_FACTOR_SEED) {
    insert.run(r.kind, r.idx, r.factor, now, r.kind, r.idx);
  }
}

/** Phase 10: the shipped churn weight vector — recency-dominated, so a brand-new tenant
 *  gets a sensible "silent past their own cadence = likely gone" score before it has a
 *  single lapse to learn from. trend is entered centred at 1 (see lib/predict/churn). */
export const CHURN_MODEL_SEED = {
  bias: -1.2,
  recency_ratio: 1.1,
  trend: -0.8,
  tenure_months: -0.3,
  complaints_90d: 0.5,
  overdue_ratio: 0.7,
};

export function seedChurnModel(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO churn_models (organization_id, weights_json, n_obs, updated_at)
     SELECT NULL, ?, 0, ?
      WHERE NOT EXISTS (SELECT 1 FROM churn_models WHERE organization_id IS NULL)`
  ).run(JSON.stringify(CHURN_MODEL_SEED), now);
}

export function seedCapacityFactors(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO capacity_factors
       (organization_id, condition_code, stop_factor, service_time_factor, speed_factor,
        max_duration_factor, note_fa, active, updated_at)
     SELECT NULL, ?, ?, ?, ?, ?, ?, 1, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM capacity_factors WHERE organization_id IS NULL AND condition_code = ?
      )`
  );
  for (const r of CAPACITY_FACTOR_SEED) {
    insert.run(r.code, r.stop, r.service, r.speed, r.duration, r.note, now, r.code);
  }
}

export function seedReasonCodes(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO reason_codes (organization_id, domain, code, label_fa, active, created_at)
     SELECT NULL, ?, ?, ?, 1, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM reason_codes
         WHERE organization_id IS NULL AND domain = ? AND code = ?
      )`
  );
  for (const r of REASON_CODE_SEED) {
    insert.run(r.domain, r.code, r.label_fa, now, r.domain, r.code);
  }
}

/** Fills in centroids for districts that have none. Runs on every boot but only touches
 *  rows still NULL, so the ~600KB geometry read happens once after the migration (and
 *  again only for newly drawn districts) rather than on every start.
 *
 *  A district whose geometry cannot produce a centroid is left NULL rather than given a
 *  fake one: NULL sorts to the end of a distance ranking, a wrong coordinate does not. */
export function backfillDistrictCentroids(db: DatabaseSync): void {
  const pending = db
    .prepare("SELECT id, boundary_geojson FROM districts WHERE centroid_lat IS NULL AND boundary_geojson IS NOT NULL")
    .all() as unknown as { id: number; boundary_geojson: string }[];
  if (pending.length === 0) return;

  const update = db.prepare("UPDATE districts SET centroid_lat = ?, centroid_lng = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const row of pending) {
      let centroid: { lat: number; lng: number } | null = null;
      try {
        centroid = polygonCentroid(JSON.parse(row.boundary_geojson) as DistrictGeometry);
      } catch {
        centroid = null; // malformed geometry -- leave it NULL, see the doc comment
      }
      if (centroid) update.run(centroid.lat, centroid.lng, row.id);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
