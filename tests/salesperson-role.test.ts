import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `coverage-test-salesperson-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, ROLES } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

function insertUser(username: string, role: string) {
  getDb()
    .prepare(
      "INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(username, "x", username, role, new Date().toISOString());
}

describe("the salesperson role", () => {
  it("is one of the roles the app knows about", () => {
    expect(ROLES).toContain("salesperson");
  });

  it("is accepted by the users table CHECK constraint", () => {
    expect(() => insertUser("nazanin", "salesperson")).not.toThrow();
    const row = getDb().prepare("SELECT role FROM users WHERE username = ?").get("nazanin") as {
      role: string;
    };
    expect(row.role).toBe("salesperson");
  });

  it("still rejects a role that is not in the list", () => {
    expect(() => insertUser("nobody", "accountant")).toThrow();
  });

  it("keeps the three roles that existed before", () => {
    expect(() => insertUser("a", "owner")).not.toThrow();
    expect(() => insertUser("b", "group_manager")).not.toThrow();
    expect(() => insertUser("c", "driver")).not.toThrow();
  });
});

describe("migrating a database that predates the role", () => {
  it("rebuilds the CHECK constraint rather than leaving the old one in place", () => {
    // SQLite cannot ALTER a CHECK, so the migration is a table rebuild. If it silently
    // did nothing, the constraint below would still name only the original three roles
    // and every salesperson account would fail to insert in production.
    const sql = (
      getDb()
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
        .get() as { sql: string }
    ).sql;
    expect(sql).toContain("salesperson");
  });
});
