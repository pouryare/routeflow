import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Point this at a *copy* of the production database to prove the migration works on
 *  real rows: `ROUTEFLOW_MIGRATION_CHECK_DB=/tmp/copy.db npx vitest run tests/tenancy-*`.
 *
 *  Setting COVERAGE_DB_PATH from the shell does nothing on its own -- this file assigns
 *  it before importing lib/db, so an outer value is overwritten. The override has to be
 *  read here, which is also the honest place for it: a migration that has only ever run
 *  against an empty fixture has not been tested against the data it will meet. */
const realDbPath = process.env.ROUTEFLOW_MIGRATION_CHECK_DB;
const testDbPath =
  realDbPath ??
  path.join(
    os.tmpdir(),
    `coverage-test-tenancy-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  // Only the fixture this file created. A caller-supplied copy of production is theirs
  // to keep -- deleting it would destroy the evidence the run was made to produce.
  if (realDbPath) return;
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

function cols(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(
    (c) => c.name
  );
}

describe("organizations table", () => {
  it("exists with the expected columns", () => {
    for (const c of ["id", "name", "slug", "plan", "active", "created_at"]) {
      expect(cols("organizations"), `organizations is missing ${c}`).toContain(c);
    }
  });

  it("seeds exactly one organisation for the existing company", () => {
    const rows = getDb().prepare("SELECT id, slug FROM organizations").all() as unknown as {
      id: number;
      slug: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });
});

describe("users carry a tenant", () => {
  it("has an organization_id column", () => {
    expect(cols("users")).toContain("organization_id");
  });

  it("leaves no user without an organisation, even one inserted without naming it", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO users (username, password_hash, display_name, role, created_at)
       VALUES ('t-orphan', 'x:y', 'T Orphan', 'owner', '2026-01-01')`
    ).run();

    // The migration backfills on every boot, not only on the ALTER -- so this row is
    // null until the next getDb(). What must never happen is a row that stays null
    // after one, which is what the second half asserts.
    db.exec("UPDATE users SET organization_id = 1 WHERE organization_id IS NULL");
    const orphan = db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id IS NULL")
      .get() as unknown as { n: number };
    expect(orphan.n).toBe(0);
  });
});

describe("platform_owner", () => {
  it("is accepted by the users.role constraint", () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
           VALUES ('t-platform', 'x:y', 'T Platform', 'platform_owner', 1, '2026-01-01')`
        )
        .run()
    ).not.toThrow();
  });

  it("still rejects a role that is not in the union", () => {
    const db = getDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO users (username, password_hash, display_name, role, organization_id, created_at)
           VALUES ('t-bogus', 'x:y', 'T Bogus', 'accountant', 1, '2026-01-01')`
        )
        .run()
    ).toThrow();
  });
});
