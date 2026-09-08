import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `coverage-test-fac-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, seedFacilities } = await import("@/lib/db");

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${suffix}`, { force: true });
});

beforeAll(() => {
  getDb();
});

describe("facilities schema", () => {
  it("seeds exactly the two starting sites", () => {
    const rows = getDb()
      .prepare("SELECT slug, kind, is_default_origin FROM facilities ORDER BY slug")
      .all() as unknown as { slug: string; kind: string }[];
    expect(rows.map((r) => r.slug)).toEqual(["home-pardis", "warehouse-bakeh"]);
    expect(rows.find((r) => r.slug === "home-pardis")?.kind).toBe("home_base");
    expect(rows.find((r) => r.slug === "warehouse-bakeh")?.kind).toBe("warehouse");
  });

  // The seed runs on every boot, and a restored backup already has these rows. An edit
  // the user made must survive both -- which is why this is INSERT OR IGNORE and not
  // INSERT OR REPLACE.
  it("is idempotent — re-seeding never duplicates or overwrites", () => {
    const db = getDb();
    db.prepare("UPDATE facilities SET name = 'edited by user' WHERE slug = 'home-pardis'").run();
    seedFacilities(db);
    const rows = db
      .prepare("SELECT name FROM facilities WHERE slug = 'home-pardis'")
      .all() as unknown as { name: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("edited by user");
  });

  it("marks exactly one row as the default origin, and it is the home base", () => {
    const rows = getDb()
      .prepare("SELECT slug FROM facilities WHERE is_default_origin = 1")
      .all() as unknown as { slug: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].slug).toBe("home-pardis");
  });

  it("rejects a kind outside the allowed set", () => {
    const db = getDb();
    const now = new Date().toISOString();
    expect(() =>
      db
        .prepare(
          `INSERT INTO facilities (slug, kind, name, lat, lng, is_default_origin, created_at, updated_at)
           VALUES ('bad', 'spaceport', 'x', 35.7, 51.4, 0, ?, ?)`
        )
        .run(now, now)
    ).toThrow();
  });
});
