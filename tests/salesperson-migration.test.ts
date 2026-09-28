import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Migrating a database that already looks like production.
 *
 *  The fresh-database tests cannot catch the failure this file is about: on a new file the
 *  CREATE TABLE already carries the new constraint and the rebuild never runs. Production
 *  is the opposite case -- an existing users table with the old CHECK, rows in it, and
 *  activity_log rows pointing at those rows through a foreign key.
 *
 *  SQLite cannot ALTER a CHECK, so the migration must DROP and recreate users. With
 *  PRAGMA foreign_keys = ON -- which lib/db.ts sets -- dropping a table that children
 *  reference raises a constraint violation. So this seeds exactly that shape first.
 */
const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-sp-migration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);

const LEGACY_USERS = `
  CREATE TABLE users (
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
`;

beforeAll(() => {
  const seed = new DatabaseSync(testDbPath);
  seed.exec("PRAGMA journal_mode = WAL;");
  seed.exec(`
    CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      color TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    ${LEGACY_USERS}
    CREATE TABLE activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('district', 'customer', 'facility', 'lead_location')),
      entity_id INTEGER NOT NULL,
      event_type TEXT NOT NULL CHECK (event_type IN ('status_change', 'note', 'assigned')),
      old_value TEXT,
      new_value TEXT,
      note TEXT,
      changed_by TEXT,
      created_at TEXT NOT NULL,
      changed_by_user_id INTEGER REFERENCES users(id)
    );
  `);
  const now = new Date().toISOString();
  seed
    .prepare(
      "INSERT INTO users (id, username, password_hash, display_name, role, staff_code, token_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(7, "pourya", "hash-that-must-survive", "پوریا", "owner", "SP0", 3, now);
  seed
    .prepare(
      "INSERT INTO activity_log (entity_type, entity_id, event_type, new_value, changed_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run("customer", 1, "status_change", "فعال", 7, now);
  seed.close();

  process.env.ROUTEFLOW_DB_PATH = testDbPath;
  process.env.SESSION_SECRET = "test-secret";
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

describe("upgrading a production-shaped database", () => {
  it("rebuilds users despite the foreign key pointing at it", async () => {
    const { getDb } = await import("@/lib/db");
    expect(() => getDb()).not.toThrow();
  });

  it("accepts a salesperson afterwards", async () => {
    const { getDb } = await import("@/lib/db");
    expect(() =>
      getDb()
        .prepare(
          "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run("nazanin", "x", "نازنین", "phone_sales", new Date().toISOString())
    ).not.toThrow();
  });

  it("keeps every column of the existing account, not just its id", async () => {
    const { getDb } = await import("@/lib/db");
    const row = getDb().prepare("SELECT * FROM users WHERE id = 7").get() as Record<string, unknown>;
    expect(row.username).toBe("pourya");
    expect(row.password_hash).toBe("hash-that-must-survive");
    expect(row.display_name).toBe("پوریا");
    expect(row.role).toBe("owner");
    expect(row.staff_code).toBe("SP0");
    // token_version is the revocation lever. Losing it would silently sign everyone out.
    expect(row.token_version).toBe(3);
  });

  it("keeps the activity_log row that referenced the user", async () => {
    const { getDb } = await import("@/lib/db");
    const row = getDb()
      .prepare("SELECT changed_by_user_id FROM activity_log WHERE entity_type = 'customer'")
      .get() as { changed_by_user_id: number };
    expect(row.changed_by_user_id).toBe(7);
  });

  it("leaves foreign keys enforced afterwards", async () => {
    // The rebuild has to turn them off. If it forgets to turn them back on, every
    // later write in the process silently loses its referential integrity.
    const { getDb } = await import("@/lib/db");
    const row = getDb().prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });
});
