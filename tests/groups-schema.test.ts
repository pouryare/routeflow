import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-groups-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.COVERAGE_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

function cols(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name);
}

describe("groups schema", () => {
  it("creates a groups table with the expected columns", () => {
    expect(cols("groups").sort()).toEqual(["active", "color", "created_at", "id", "name", "slug"].sort());
  });

  it("requires group names and slugs to be unique", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
      .run("گروه شرق", "east", "#2DE0E6", now);
    expect(() =>
      db.prepare("INSERT INTO groups (name, slug, color, active, created_at) VALUES (?, ?, ?, 1, ?)")
        .run("گروه شرق", "east-2", "#fff", now)
    ).toThrow();
  });
});

describe("users rebuild", () => {
  it("carries the new identity columns", () => {
    expect(cols("users").sort()).toEqual(
      ["active", "created_at", "display_name", "group_id", "id", "location_consent_at", "password_hash", "phone", "role", "staff_code", "token_version", "username"].sort()
    );
  });

  it("rejects a role outside the three known values", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)")
        .run("bad", "x:y", "Bad", "superuser", now)
    ).toThrow();
  });

  it("defaults active to 1 and token_version to 0", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("driver1", "x:y", "یوسف", "driver", now);
    const row = db.prepare("SELECT active, token_version FROM users WHERE username = 'driver1'").get() as {
      active: number; token_version: number;
    };
    expect(row.active).toBe(1);
    expect(row.token_version).toBe(0);
  });
});

describe("group_id columns", () => {
  it("adds group_id to districts and customers", () => {
    expect(cols("districts")).toContain("group_id");
    expect(cols("customers")).toContain("group_id");
  });
});
