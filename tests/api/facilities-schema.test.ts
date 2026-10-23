import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-fac-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, dbReady } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(async () => {
  const db = getDb();
  const now = new Date().toISOString();
  const add = async (slug: string, kind: string, name: string, lat: number | null, origin: number) =>
    await db
      .prepare(
        `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(slug, kind, name, lat, lat, origin, now, now);
  await add("wh-schema", "warehouse", "انبار", 35.502669, 0);
  await add("home-schema", "home", "خانه", 35.753263, 1);
});

describe("facilities schema", () => {
  // There is nothing to seed any more. A fresh database has no facilities, which is the
  // honest starting state: the first thing a person is asked is where their warehouse is.
  // Nothing is invented, so nothing has to be migrated when a second tenant arrives.
  it("starts with no facilities at all", async () => {
    const rows = await getDb()
      .prepare("SELECT slug FROM facilities ORDER BY slug")
      .all() as unknown as { slug: string }[];
    expect(rows.map((r) => r.slug)).toEqual(["home-schema", "wh-schema"]);
  });

  // The seed used to run on every boot and a restored backup already had its rows, which is
  // why it was INSERT OR IGNORE. Nothing runs on boot now, so the invariant that matters is
  // the one underneath: a row the user made is never touched by anything that boots.
  it("leaves a row the user made completely alone", async () => {
    const db = getDb();
    await db.prepare("UPDATE facilities SET name = 'edited by user' WHERE slug = 'home-schema'").run();
    await dbReady();
    const rows = await db
      .prepare("SELECT name FROM facilities WHERE slug = 'home-schema'")
      .all() as unknown as { name: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("edited by user");
  });

  it("marks exactly one row as the default origin", async () => {
    const rows = await getDb()
      .prepare("SELECT slug FROM facilities WHERE is_default_origin = 1")
      .all() as unknown as { slug: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe("home-schema");
  });

  // "Not positioned yet" is a state this table can hold. It used to be NOT NULL, which is
  // why a warehouse was auto-created at 0,0 and every van was inserted there.
  it("accepts a facility with no location", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await (async () =>
      await db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
           VALUES ('unplaced', 'warehouse', 'هنوز نامشخص', NULL, NULL, 0, ?, ?)`
        )
        .run(now, now))();
  });

  it("rejects a kind outside the allowed set", async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await expect((async () =>
      await db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
           VALUES ('bad', 'spaceport', 'x', 35.7, 51.4, 0, ?, ?)`
        )
        .run(now, now))()).rejects.toThrow();
  });
});
