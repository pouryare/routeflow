import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sqliteOnly, tableInfo } from "./helpers/schema";

const testDbPath = path.join(os.tmpdir(), `rf-districts-shared-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb, TENANT_TABLES } = await import("@/lib/db");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const cols = async (t: string) => (await tableInfo(t) as { name: string }[]).map((c) => c.name);
const schema = async (t: string) =>
  (await getDb().prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) as { sql: string }).sql;

/** districts is geography: Tehran's 22 mantaghe are the same for every organisation.
 *
 *  The schema said otherwise. districts sat in TENANT_TABLES -- whose stated purpose is to
 *  catch a table "readable by every organisation and looks like nothing at all until a
 *  second tenant is on the system" -- and its UNIQUE was
 *  (organization_id, name, level, parent_name). Per-tenant copies of the same polygons can
 *  drift apart until منطقه 14 means two different places, so geography is shared reference
 *  data and the scoping was the bug.
 *
 *  The fix is two edits that only work together. Dropping districts from TENANT_TABLES stops
 *  the two boot sweeps (lib/db.ts:2625, :3471) re-ALTERing organization_id back and stamping
 *  it to 1 on every row; retargeting the rebuild at :2754 stops it re-adding the org-scoped
 *  key. Either alone leaves the other undoing it on the next boot. */
describe("districts are shared reference data, not tenant data", () => {
  it("is not a tenant table", () => {
    expect((TENANT_TABLES as readonly string[]).includes("districts")).toBe(false);
  });

  it("has no organization_id column after boot", async () => {
    expect(await cols("districts")).not.toContain("organization_id");
  });

  it.skipIf(sqliteOnly)("keeps the plain natural key", async () => {
    expect(await schema("districts")).toContain("UNIQUE(name, level, parent_name)");
    expect(await schema("districts")).not.toContain("organization_id");
  });

  it("keeps every other district column the code and geometry depend on", async () => {
    // The rebuild replaces the table wholesale, so a column quietly left out of the
    // createSql would vanish here rather than at the point of use.
    expect(await cols("districts")).toEqual(expect.arrayContaining([
      "id", "name", "level", "parent_name", "boundary_geojson",
      "coverage_status", "notes", "is_custom", "updated_at",
      "assigned_to", "centroid_lat", "centroid_lng", "group_id",
    ]));
  });

  // The reason parent_name must be '' and not NULL, and the reason this file is not only
  // about tenancy. In SQLite a NULL never equals another NULL inside a UNIQUE index, so a
  // NULL parent makes INSERT OR IGNORE insert a fresh copy on every run -- which is what all
  // three seed scripts claimed their OR IGNORE prevented. Measured: 3 runs, 3 rows.
  it("actually dedupes: three identical inserts leave one row", async () => {
    const db = getDb();
    const geo = JSON.stringify({
      type: "Polygon",
      coordinates: [[[51.4, 35.7], [51.5, 35.7], [51.5, 35.8], [51.4, 35.8], [51.4, 35.7]]],
    });
    const ins = db.prepare(
      `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
       VALUES (?, ?, ?, ?, 'unknown', 0, ?) ON CONFLICT DO NOTHING`
    );
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) await ins.run("منطقه 14", "mantaghe", "", geo, now);
    const n = (await db.prepare("SELECT COUNT(*) c FROM districts WHERE name = ?").get("منطقه 14") as { c: number }).c;
    expect(n, "parent_name='' must dedupe; NULL would not").toBe(1);
  });
});
