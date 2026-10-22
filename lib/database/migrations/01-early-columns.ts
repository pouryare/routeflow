/* Migration era 01: Column additions and CHECK widenings that predate tenancy (credit limit, product stock policy, saved-location scoring, district centroids, activity log, the first role vocabulary).
 * Moved out of lib/db.ts's getDb() unchanged; the eras run in numeric order from ../migrate.ts and
 * each statement is idempotent (it inspects the live schema first). */
import type { DatabaseSync } from "node:sqlite";

export function applyEarlyColumns(db: DatabaseSync): void {
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

  /* Who pasted the links. The "this import is slow" notice goes to that person, and a job
     created before this column existed has nobody to tell, so it stays NULL (no guess). */
  const importJobCols = db.prepare("PRAGMA table_info(lead_import_jobs)").all() as { name: string }[];
  if (!importJobCols.some((c) => c.name === "created_by")) {
    db.exec("ALTER TABLE lead_import_jobs ADD COLUMN created_by INTEGER REFERENCES users(id)");
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
}
