import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-facilities-rebuild-${Date.now()}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { DatabaseSync } = await import("node:sqlite");
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

/* A database that predates the `home` widening AND has rows in the two tables that reference
 * facilities(id).
 *
 * Why this file exists at all: tests/notifications-phase2-migration-realdata.test.ts catches
 * exactly this bug, but only when a backup happens to be on disk, and it SKIPS when one is not.
 * So the migration's real-data path is untested on any machine without a backup — which is
 * every CI runner, and therefore every future change to this migration. */
function seedLegacyDatabase(): void {
  /* Open the file DIRECTLY rather than through getDb().
   *
   * getDb() migrates on first call, so seeding through it would migrate the schema BEFORE the
   * old table existed — the test would then pass against a database that never had the bug.
   * The legacy schema has to be in place first, and only the SECOND getDb() can migrate it. */
  if (!fs.existsSync(testDbPath)) getDb(); // create the file with the real schema in it
  const db = new DatabaseSync(testDbPath);
  db.exec("PRAGMA foreign_keys = OFF");
  const now = "2026-01-01T00:00:00.000Z";

  // A facilities table carrying the OLD check, as a pre-Phase-1 database has it.
  /* The REAL pre-Phase-1 schema, copied verbatim from lib/db.ts at fa2f539~1:1812 — not
   * written from memory. Two details matter and both were wrong when guessed: `lat/lng` were
   * NOT NULL (which is why the old auto-create had to invent 0,0), and there is no group_id
   * (it arrives with the tenant-unique pass). A hand-written approximation tests a schema that
   * never existed, which is how a migration test passes while the bug is still live. */
  db.exec(`
    DROP TABLE IF EXISTS facilities;
    CREATE TABLE facilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('warehouse', 'home_base', 'other', 'van')),
      name TEXT NOT NULL,
      address TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      maps_url TEXT,
      notes TEXT,
      is_default_origin INTEGER NOT NULL DEFAULT 0,
      owner_username TEXT,
      organization_id INTEGER REFERENCES organizations(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_facilities_kind ON facilities(kind);
  `);
  // `updated_at` is NOT NULL in the real schema (fa2f539~1:1826), so it is set here too.
  const f = db.prepare(
    "INSERT INTO facilities (slug, kind, name, lat, lng, organization_id, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?)"
  );
  f.run("legacy-home", "home_base", "خانهٔ قدیمی", 35.7, 51.4, now, now);
  f.run("legacy-wh", "warehouse", "انبار قدیمی", 35.6, 51.3, now, now);

  // The referents. stock_movements.facility_id is NOT NULL (db.ts:2265), so the rows below
  // cannot be built without a facility -- which is precisely why the DROP failed.
  // Column names read from the DDL at db.ts:2677 — not guessed. `base_qty`, not qty_base;
  // `notes`, not note; PURCHASE_IN, not IN.
  const mv = db.prepare(
    `INSERT INTO stock_movements (organization_id, facility_id, product_id, base_qty, kind, occurred_at, notes, created_at)
     VALUES (1, ?, ?, 5, 'PURCHASE_IN', ?, 'legacy', ?)`
  );
  const product = db.prepare(
    "INSERT INTO products (name, kg_per_base_unit, created_at, updated_at, organization_id) VALUES ('کره', 0.25, ?, ?, 1)"
  ).run(now, now);
  const pid = Number(product.lastInsertRowid);
  mv.run(1, pid, now, now);
  mv.run(2, pid, now, now);

  db.exec("DROP TABLE IF EXISTS facilities_kind_new");
  db.close();
}

describe("widening facilities.kind on a database that references it", () => {
  beforeEach(() => seedLegacyDatabase());

  it("migrates home_base to home without dropping the rows that point at facilities", async () => {
    /* THE REGRESSION.
     *
     * Two tables reference facilities(id): stock_movements.facility_id and
     * vehicles.facility_id. The rebuild did `DROP TABLE facilities` with foreign-key
     * enforcement ON, so on any database with rows in either, getDb() threw
     * "FOREIGN KEY constraint failed" while MIGRATING -- before it could do anything else.
     * The whole application would not open.
     *
     * A fresh install passes, because both tables are empty. That is why this went unnoticed
     * until a test copied a real backup. */
    vi.resetModules();
    const fresh = (await import("@/lib/db")).getDb;
    expect(() => fresh()).not.toThrow();

    const db = fresh();
    const kinds = db.prepare("SELECT kind FROM facilities ORDER BY id").all() as { kind: string }[];
    expect(kinds.map((k) => k.kind)).toEqual(["home", "warehouse"]);

    // And the rows that referenced it survived — a foreign key that still resolves.
    const still = db
      .prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE facility_id IN (SELECT id FROM facilities)")
      .get() as { n: number };
    expect(still.n).toBe(2);
  });

  it("recovers when a previous attempt left the scratch table behind", async () => {
    /* The DROP and the RENAME are two statements. A process that dies between them leaves
     * facilities_kind_new on disk, and the next boot used to fail with "table already exists"
     * -- on a table nobody knows the contents of. Every real row is still in `facilities` at
     * that point, so discarding it is safe and must be automatic. */
    vi.resetModules();
    const first = (await import("@/lib/db")).getDb;
    first();
    first()
      .prepare("INSERT INTO facilities (slug, kind, name, lat, lng, organization_id, created_at, updated_at) VALUES ('stale','other','نیمه‌کاره',35,51,1,'2026-01-01','2026-01-01')")
      .run();
    // Simulate the leftover: the scratch table the migration creates, abandoned.
    first().exec("CREATE TABLE facilities_kind_new (id INTEGER PRIMARY KEY)");

    vi.resetModules();
    const second = (await import("@/lib/db")).getDb;
    expect(() => second()).not.toThrow();
    const db = second();
    expect((db.prepare("SELECT COUNT(*) AS n FROM facilities").get() as { n: number }).n).toBe(3);
  });

  it("still widens the CHECK for a database that never had the old one", async () => {
    /* The guard is on the constraint TEXT, not on a column: a database already carrying 'home'
     * must not be rebuilt at all, or every boot would rewrite the table for nothing. */
    vi.resetModules();
    const db = (await import("@/lib/db")).getDb();
    const sql = (db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='facilities'")
      .get() as { sql: string }).sql;
    expect(sql).toContain("'home'");
    // 'home_base' must be gone: leaving it would let a future write reintroduce a kind that
    // nothing reads.
    expect(sql).not.toContain("'home_base'");
  });
});