import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const testDbPath = path.join(os.tmpdir(), `rf-dprec-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ROUTEFLOW_DB_PATH = testDbPath;
process.env.SESSION_SECRET = "test-secret";

const { getDb } = await import("@/lib/db");
const { districtIdForPoint, groupForPoint, recomputeCustomerGroups } = await import("@/lib/groups");

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

// A GeoJSON Polygon: one ring of [lng, lat] pairs. The repo nests MultiPolygon one level
// deeper, and a fixture built to the wrong depth is silently rejected rather than erroring.
const square = (lng: number, lat: number, size = 0.2) => {
  const h = size / 2;
  return JSON.stringify({
    type: "Polygon",
    coordinates: [[[lng - h, lat - h], [lng + h, lat - h], [lng + h, lat + h], [lng - h, lat + h], [lng - h, lat - h]]],
  });
};

const db = getDb();
const ins = db.prepare(
  `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
   VALUES (?, ?, '', ?, 'unknown', ?, ?)`
);
const now = new Date().toISOString();
// A coarse بخش seeded first, and a hand-drawn district nested inside it -- which is the real
// shape of every future refinement: the operator draws a tighter boundary after the fact.
const coarse = Number(ins.run("بخش رودهن", "mantaghe", square(51.93, 35.73, 0.4), 0, now).lastInsertRowid);
const custom = Number(ins.run("هراز", "mantaghe", square(51.93, 35.73, 0.04), 1, now).lastInsertRowid);

/** A hand-drawn district must beat the coarse administrative polygon containing it.
 *
 *  Without this, every place the seed data did not anticipate is filed under the coarse
 *  بخش and the boundary an operator drew is silently ignored -- because a بخش is stored at
 *  level='mantaghe' (seed-bakhsh.ts), the SAME level a drawn district gets, so the existing
 *  `ORDER BY CASE level ... END, id` falls through to id and the custom district, always
 *  inserted later, always loses. The point still matches something, so nothing errors. */
describe("a hand-drawn district beats the coarse one containing it", () => {
  it("resolves a point inside the custom district to the custom district", () => {
    expect(districtIdForPoint(db, 35.73, 51.93)).toBe(custom);
  });

  it("still resolves a point outside it to the coarse district", () => {
    expect(districtIdForPoint(db, 35.85, 51.93)).toBe(coarse);
  });

  it("agrees with recomputeCustomerGroups on the same point", () => {
    // The two carry the same ORDER BY. If they drift, the backfill and the running app
    // classify one point two different ways -- worse than either being wrong alone.
    db.prepare("INSERT INTO customers (customer_code, business_name, lat, lng, organization_id, synced_at) VALUES ('C1','ت',?,?,1,?)")
      .run(35.73, 51.93, now);
    // A real group row: districts.group_id is a foreign key, so a bare 7 would fail the
    // insert rather than exercise the code path this test is about.
    db.prepare("INSERT INTO groups (name, slug, created_at, organization_id) VALUES ('territory','territory',?,1)").run(now);
    const gid = Number((db.prepare("SELECT id FROM groups WHERE slug = 'territory'").get() as { id: number }).id);
    db.prepare("UPDATE districts SET group_id = ? WHERE id = ?").run(gid, custom);
    recomputeCustomerGroups(db, 1);
    const row = db.prepare("SELECT group_id FROM customers WHERE customer_code = 'C1'").get() as { group_id: number | null };
    expect(row.group_id).toBe(groupForPoint(db, 35.73, 51.93, 1));
  });

  it("keeps the two functions' ORDER BY identical", () => {
    // A source-level guard for a drift that would only show up as a wrong territory on a
    // map, long after the backfill and the app had quietly disagreed.
    const src = fs.readFileSync(path.join(process.cwd(), "lib", "groups.ts"), "utf8");
    // Only the queries that read `districts`. readGroups sorts the groups table by name,
    // which has nothing to do with district precedence.
    // Matched across the newline in the template literal, and only for queries that read
    // districts -- readGroups sorts the groups table by name and is not one of these.
    const districtQueries = [...src.matchAll(/FROM districts[\s\S]{0,160}?ORDER BY ([^`]+)/g)]
      .map((m) => m[1].replace(/\s+/g, " ").trim());
    expect(districtQueries.length, "expected two district ORDER BY clauses").toBe(2);
    for (const o of districtQueries) {
      expect(o, "both district queries must share the one precedence constant").toBe("${DISTRICT_PRECEDENCE_SQL}");
    }
    expect(src, "the shared precedence must prefer is_custom").toMatch(/DISTRICT_PRECEDENCE_SQL = "d\.is_custom DESC/);
  });
});
