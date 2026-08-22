// One-time setup: coarse-tier coverage zones for the rest of Tehran province, one
// per بخش (the sub-county administrative unit OSM uses at admin_level=6 in Iran).
// Rendered like مantaghe (subtle wash) -- the same coarse/fine split already used for
// Tehran city (مantaghe wash + محله detail), extended province-wide. بخش مرکزی شهرستان
// تهران is intentionally excluded: that area is already covered by the fine-grained
// 22 منطقه + 356 محله set, so a third overlapping wash layer would be pure redundancy.
// Boundaries sourced from OSM (admin_level=6 relations), stitched + simplified.
// Run once: node --experimental-strip-types scripts/seed-bakhsh.ts
// Safe to re-run: INSERT OR IGNORE, never overwrites a status a user already set.
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db.ts";

const db = getDb();
const now = new Date().toISOString();

const rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "bakhsh-districts.json"), "utf8"));

const insert = db.prepare(`
  INSERT OR IGNORE INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
  VALUES (?, 'mantaghe', NULL, ?, 'unknown', 0, ?)
`);

let count = 0;
db.exec("BEGIN");
try {
  for (const r of rows) {
    if (!r.geometry) continue;
    insert.run(r.name, JSON.stringify(r.geometry), now);
    count++;
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(`seeded ${count} بخش districts (existing rows left untouched)`);
const total = db.prepare("SELECT COUNT(*) as c FROM districts").get() as { c: number };
console.log(`districts table now has ${total.c} rows total`);
