// One-time setup: load coverage-zone polygons for the towns east of Tehran city
// (Pardis, Bumehen, Rudehen, Damavand, Abali, Absard, Kilan) where a large share of
// customers outside Tehran city itself are located. Boundaries sourced from OSM
// (admin_level=7 relations), stitched from way geometry into closed rings.
// Run once: node --experimental-strip-types scripts/seed-outer-towns.ts
// Safe to re-run: INSERT OR IGNORE, never overwrites a status a user already set.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Each town's county, established by casting its centroid against the bakhsh polygons in
// data/bakhsh-districts.json. That file settles it on its own: بخش رودهن is a SEPARATE
// بخش from بخش مرکزی ری, so رودهن and آبعلی are in شهرستان رودهن and not ری -- the
// neighbouring-county guess an earlier revision of this file made, and one this file's own
// data disproves. بومهن is in بخش بومهن, which is in شهرستان ری. The remaining three
// fall in بخش مرکزی شهرستان دماوند.
//
// The old single-entry map sent all seven to دماوند, which was wrong for پردیس and بومهن
// as well as these three.
const PARENT_COUNTY: Record<string, string> = {
  پردیس: "شهرستان پردیس",
  بومهن: "شهرستان ری",
  رودهن: "شهرستان رودهن",
  آبعلی: "شهرستان رودهن",
  دماوند: "شهرستان دماوند",
  آبسرد: "شهرستان دماوند",
  کیلان: "شهرستان دماوند",
};
// Only reached if a town is added to outer-towns.json without a county above. دماوند is
// the fallback because two thirds of the seeded towns are in it, and a wrong-but-uniform
// default is easier to spot in the admin UI than a wrong-but-plausible guess.
const DEFAULT_PARENT = "شهرستان دماوند";

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
