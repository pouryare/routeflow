/* Migration era 02: Tenancy bootstrap: the organisation table, users.organization_id, and the platform_owner and rep_manager roles.
 * Moved out of lib/db.ts's getDb() unchanged; the eras run in numeric order from ../migrate.ts and
 * each statement is idempotent (it inspects the live schema first). */
import type { DatabaseSync } from "node:sqlite";

export function applyTenancyBootstrap(db: DatabaseSync): void {
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
}
