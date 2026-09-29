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
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Opens the database directly rather than through lib/db.ts: a seed is a data load, not
// a boot, and lib/db.ts pulls in the rest of the app -- which Node's type stripping cannot
// resolve without a bundler (ERR_MODULE_NOT_FOUND on lib/repo/retiredWording). The same
// reason, and the same fix, as scripts/split-districts.ts:17-22.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const now = new Date().toISOString();

const rows = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "bakhsh-districts.json"), "utf8"));

// parent_name is '' and not NULL: UNIQUE(name, level, parent_name) treats every NULL as
// distinct from every other NULL, so a NULL parent makes INSERT OR IGNORE insert a fresh
// copy on every run -- which is what the header comment above claims it prevents.
const insert = db.prepare(`
  INSERT OR IGNORE INTO districts (name, level, parent_name, boundary_geojson, coverage_status, is_custom, updated_at)
  VALUES (?, 'mantaghe', '', ?, 'unknown', 0, ?)
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
