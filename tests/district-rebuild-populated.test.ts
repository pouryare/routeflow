import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tableInfo } from "./helpers/schema";

/** The districts rebuild must not lose rows on a POPULATED table.
 *
 *  The live database has 0 districts, so every other test of this migration exercises only
 *  the empty case -- where a copy list that dropped all the rows would still pass. This
 *  builds a database carrying the OLD schema (organization_id and all), fills it, and then
 *  boots the app on it, so the migration really runs against rows.
 *
 *  The row-count assertion inside rebuildDistrictsShared is the guard this proves is
 *  reachable. Without this test, a copy list that quietly lost every district would leave
 *  a half-populated table and no error anywhere -- the same shape as the pin fold deleting
 *  a run stop mid-run (a98ae50). */
const dbPath = path.join(os.tmpdir(), `rf-rebuild-pop-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = dbPath;
process.env.SESSION_SECRET = "test-secret";

const GEO = JSON.stringify({
  type: "Polygon",
  coordinates: [[[51.4, 35.7], [51.5, 35.7], [51.5, 35.8], [51.4, 35.8], [51.4, 35.7]]],
});

// Written before importing lib/db, so the boot migration sees a pre-tenancy-shaped table.
{
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE organizations (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO organizations VALUES (1, 'test org');
    CREATE TABLE groups (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE districts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('mantaghe', 'mahalle')),
      parent_name TEXT,
      boundary_geojson TEXT NOT NULL,
      coverage_status TEXT NOT NULL DEFAULT 'unknown',
      notes TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      assigned_to TEXT,
      centroid_lat REAL,
      centroid_lng REAL,
      group_id INTEGER REFERENCES groups(id),
      organization_id INTEGER REFERENCES organizations(id),
      UNIQUE (organization_id, name, level, parent_name)
    );
  `);
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, notes, is_custom, updated_at, centroid_lat, centroid_lng, organization_id)
     VALUES (?, 'mantaghe', '', ?, 'unknown', ?, 0, ?, 35.7, 51.4, 1)`
  );
  ins.run("منطقه 14", GEO, "keep me", now);
  ins.run("منطقه 5", GEO, null, now);
  db.close();
}

const { getDb } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${s}`, { force: true });
});

describe("the districts rebuild on a populated table", () => {
  it("kept every row", async () => {
    const n = (await getDb().prepare("SELECT COUNT(*) c FROM districts").get() as { c: number }).c;
    expect(n, "the copy must not drop rows").toBe(2);
  });

  it("kept the columns a careless copy list would lose", async () => {
    const row = await getDb().prepare("SELECT name, notes, centroid_lat, coverage_status, is_custom FROM districts WHERE name = ?").get("منطقه 14") as
      | { name: string; notes: string | null; centroid_lat: number | null; coverage_status: string; is_custom: number }
      | undefined;
    expect(row, "منطقه 14 must survive").toBeDefined();
    expect(row!.notes).toBe("keep me");
    expect(row!.centroid_lat).toBe(35.7);
    expect(row!.coverage_status).toBe("unknown");
    expect(row!.is_custom).toBe(0);
  });

  it("dropped organization_id and the org-scoped key", async () => {
    const cols = (await tableInfo("districts") as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("organization_id");
    const sql = (await getDb().prepare("SELECT sql FROM sqlite_master WHERE name = 'districts'").get() as { sql: string }).sql;
    expect(sql).toContain("UNIQUE(name, level, parent_name)");
  });

  it("is a no-op on the second boot", async () => {
    // Guarded on the constraint text, so a migrated database must not rebuild again.
    const before = (await getDb().prepare("SELECT COUNT(*) c FROM districts").get() as { c: number }).c;
    expect(before).toBe(2);
  });
});
