import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(
  os.tmpdir(),
  `rf-avatar-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";
const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

describe("photos table accepts 'user' avatars", () => {
  it("accepts entity_type='user'", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('user',1,?,?,?)"
        )
        .run(`stem-${Math.random()}`, now, now)
    ).not.toThrow();
  });

  it("still rejects a bogus entity_type", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('bogus',1,?,?,?)"
        )
        .run(`stem-${Math.random()}`, now, now)
    ).toThrow();
  });

  it("allows only one 'user' photo row per entity_id", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('user',2,?,?,?)"
    ).run(`stem-a-${Math.random()}`, now, now);
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('user',2,?,?,?)"
        )
        .run(`stem-b-${Math.random()}`, now, now)
    ).toThrow();
  });

  it("does not constrain a non-user entity_id the same way -- customers can have many photos", () => {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('customer',9,?,?,?)"
    ).run(`stem-c1-${Math.random()}`, now, now);
    expect(() =>
      db
        .prepare(
          "INSERT INTO photos (entity_type,entity_id,file_stem,taken_at,created_at) VALUES ('customer',9,?,?,?)"
        )
        .run(`stem-c2-${Math.random()}`, now, now)
    ).not.toThrow();
  });
});
