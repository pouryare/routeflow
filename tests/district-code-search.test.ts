import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-dsearch-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { searchDistricts } = await import("@/lib/repo/search");
const { normalisePersian } = await import("@/lib/persian");
const { MIN_REMOTE_QUERY, parseRecent } = await import("@/lib/searchModel");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

const geo = JSON.stringify({ type: "Polygon", coordinates: [[[51.4, 35.7], [51.5, 35.7], [51.5, 35.8], [51.4, 35.8], [51.4, 35.7]]] });
const NOW = new Date().toISOString();
const db = getDb();
const ins = db.prepare(
  `INSERT INTO districts (name, level, parent_name, boundary_geojson, code, coverage_status, is_custom, updated_at)
   VALUES (?, ?, '', ?, ?, 'unknown', 0, ?)`
);
await ins.run("منطقه 14", "mantaghe", geo, "14", NOW);
await ins.run("منطقه 1", "mantaghe", geo, "1", NOW);
for (let i = 1; i <= 26; i++) await ins.run(`محله ${i}`, "mahalle", geo, `14${String(i).padStart(2, "0")}`, NOW);

const session = { role: "owner", organizationId: 1, user: { id: 1 } } as never;

/** Finding a place by the number a rep can read out.
 *
 *  The code lookup is a PREFIX match and that is the whole design. Substring matching makes
 *  one keystroke useless: "1" would return منطقه 1 plus all 26 of 1401-1426 -- 27 rows for a
 *  single character. */
describe("district search by code", () => {
  it("finds a mantaghe by its own code", async () => {
    expect((await searchDistricts(db, session, "14", 5))[0]?.label).toBe("منطقه 14");
  });

  it("does not flood the results with every 14xx", async () => {
    expect((await searchDistricts(db, session, "14", 5)).length).toBeLessThanOrEqual(5);
  });

  it("does not let '1' return every 14xx", async () => {
    expect((await searchDistricts(db, session, "1", 5)).some((h) => h.id === "district:3")).toBe(false);
  });

  it("finds a mahalle by its code", async () => {
    expect((await searchDistricts(db, session, "1405", 5))[0]?.id).toBe("district:7");
  });

  // matchesQuery folds digit sets, and the existing family depends on it; a code search that
  // skipped it would find "14" but miss "۱۴", which is what a phone keyboard types.
  it("treats Persian and ASCII digits as one query", async () => {
    expect(normalisePersian("۱۴")).toBe(normalisePersian("14"));
    expect((await searchDistricts(db, session, "۱۴", 5))[0]?.label).toBe("منطقه 14");
  });

  it("respects the same two-character floor as every other kind", async () => {
    expect(await searchDistricts(db, session, "1", 5)).toEqual([]);
    expect(MIN_REMOTE_QUERY).toBe(2);
  });

  // Unlike customers, which are owner + group_manager only. A driver sent to ۱۴۰۵ has to be
  // able to look it up, and districts is shared reference data with no tenant row to leak.
  it("is visible to every role", async () => {
    const driver = { role: "driver", organizationId: 1, user: { id: 1 } } as never;
    expect((await searchDistricts(db, driver, "14", 5)).length).toBeGreaterThan(0);
  });

  it("escapes LIKE wildcards so a query cannot match everything", async () => {
    // Unescaped, "5%" matches every code ending in 5 -- a search box returning nonsense
    // rather than an error.
    expect(await searchDistricts(db, session, "%", 5)).toEqual([]);
  });

  it("a district recent survives a reload", () => {
    // isHit in lib/searchModel.ts validates stored recents against KINDS. Without
    // "district" in that list, a district the user opened would silently vanish.
    const stored = JSON.stringify([{ kind: "district", id: "district:1", label: "منطقه 14", href: "/map?district=1" }]);
    expect(parseRecent(stored)).toHaveLength(1);
  });
});
