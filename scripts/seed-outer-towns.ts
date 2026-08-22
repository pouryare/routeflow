// One-time setup: load coverage-zone polygons for the towns east of Tehran city
// (Pardis, Bumehen, Rudehen, Damavand, Abali, Absard, Kilan) where a large share of
// customers outside Tehran city itself are located. Boundaries sourced from OSM
// (admin_level=7 relations), stitched from way geometry into closed rings.
// Run once: node --experimental-strip-types scripts/seed-outer-towns.ts
// Safe to re-run: INSERT OR IGNORE, never overwrites a status a user already set.
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db.ts";

const PARENT_COUNTY: Record<string, string> = {
  پردیس: "شهرستان پردیس",
};
const DEFAULT_PARENT = "شهرستان دماوند";

const db = getDb();
const now = new Date().toISOString();

const towns = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "outer-towns.json"), "utf8"));

const insert = db.prepare(`
  INSERT OR IGNORE INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
  VALUES (?, 'mahalle', ?, ?, 'unknown', 0, ?)
`);

let count = 0;
db.exec("BEGIN");
try {
  for (const t of towns) {
    if (!t.geometry) continue;
    const parent = PARENT_COUNTY[t.name] ?? DEFAULT_PARENT;
    insert.run(t.name, parent, JSON.stringify(t.geometry), now);
    count++;
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(`seeded ${count} outer-town districts (existing rows left untouched)`);
const total = db.prepare("SELECT COUNT(*) as c FROM districts").get() as { c: number };
console.log(`districts table now has ${total.c} rows total`);
