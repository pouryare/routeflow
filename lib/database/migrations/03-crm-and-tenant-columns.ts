/* Migration era 03: CRM tables, facility icons, and the sweep that adds and backfills organization_id on every tenant table.
 * Moved out of lib/db.ts's getDb() unchanged; the eras run in numeric order from ../migrate.ts and
 * each statement is idempotent (it inspects the live schema first). */
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "../client";
import { createCrmTables } from "../../repo/crm/migrate";
import { TENANT_TABLES } from "../tenantTables";

export async function applyCrmAndTenantColumns(db: DatabaseSync, adb: Db): Promise<void> {
  // CRM (docs/superpowers/specs/2026-09-11-crm-leads-customers-design.md): created before the
  // TENANT_TABLES loop below, which ALTERs every table it lists.
  await createCrmTables(adb);

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
}
