/* One-off table rebuilds that getDb() runs when it finds an old shape (a globally-UNIQUE key
 * that must become per-tenant, a status CHECK that must widen, the facilities and districts
 * tables that changed kind). Each is idempotent: it inspects the live schema and does nothing
 * when the table is already in the new shape. Moved out of lib/db.ts unchanged. */
import type { DatabaseSync } from "node:sqlite";

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
/** The CREATE INDEX statements of every index on a table that was created by hand (not the ones
 *  SQLite makes for UNIQUE and PRIMARY KEY). DROP TABLE takes a table's indexes with it, so a
 *  rebuild that copies a table into a replacement has to put them back; before this existed, a
 *  fresh database booted without three indexes that only the NEXT boot's CREATE INDEX IF NOT
 *  EXISTS restored. */
export function indexStatementsOf(db: DatabaseSync, table: string): string[] {
  return (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name")
      .all(table) as unknown as { sql: string }[]
  ).map((r) => r.sql);
}

export function rebuildForTenantUnique(
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

  const indexes = indexStatementsOf(db, table);
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    db.exec(`
      DROP TABLE IF EXISTS ${table}_tn_new;
      ${createSql}
      INSERT INTO ${table}_tn_new (${tableCols}) SELECT ${tableCols} FROM ${table};
      DROP TABLE ${table};
      ALTER TABLE ${table}_tn_new RENAME TO ${table};
    `);
    for (const sql of indexes) db.exec(sql);
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
export function rebuildFacilitiesForVan(db: DatabaseSync): void {
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
export function rebuildDistrictsShared(db: DatabaseSync): void {
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
export function foldLeadRunsIntoDeliveryRuns(db: DatabaseSync): void {
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
export function rebuildDeliveryRunsStatus(db: DatabaseSync): void {
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
export function rebuildOrdersStatusMachine(db: DatabaseSync): void {
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
