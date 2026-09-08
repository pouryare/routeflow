// Repairs districts that are really two places sharing a name.
//
// scripts/seed-districts.ts merges source features that share (name, level, parent) into
// one MultiPolygon, because UNIQUE(name, level, parent_name) cannot hold both. That is
// right for a neighbourhood the KML draws as two overlapping placemarks, and wrong for
// two different places that merely share a name -- کوهسار in منطقه ۴ is drawn twice, 21km
// apart. Merged, they select together, share a coverage status, and hand any group that
// is given one an enclave across the city.
//
//   node --experimental-strip-types scripts/split-districts.ts [--apply]
//
// Prints what it would do and changes nothing unless --apply is passed. Idempotent: once
// split, no district has far-apart parts, so a second run finds nothing.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planSplit, type PolyGeometry } from "../lib/districtSplit.ts";

// Opens the database directly rather than through lib/db.ts: this is a repair, not a
// boot, so it has no business running migrations -- and lib/db.ts pulls in the rest of
// the app, which Node's type stripping cannot resolve without a bundler.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");

const apply = process.argv.includes("--apply");
const db = new DatabaseSync(DB_PATH);

const rows = db
  .prepare("SELECT id, name, level, parent_name, boundary_geojson, coverage_status, notes, group_id FROM districts")
  .all() as unknown as {
  id: number;
  name: string;
  level: string;
  parent_name: string | null;
  boundary_geojson: string;
  coverage_status: string;
  notes: string | null;
  group_id: number | null;
}[];

const now = new Date().toISOString();
let split = 0;
let created = 0;

for (const row of rows) {
  let geometry: PolyGeometry;
  try {
    geometry = JSON.parse(row.boundary_geojson);
  } catch {
    continue;
  }
  const pieces = planSplit(row.name, geometry);
  if (!pieces) continue;

  split++;
  console.log(`\n${row.name} (${row.parent_name ?? "—"}, id ${row.id}) -> ${pieces.length} districts`);
  for (const p of pieces) {
    console.log(`   ${p.keepsOriginal ? "keeps id " + row.id : "new row  "}  ${p.name}`);
  }
  if (!apply) continue;

  db.exec("BEGIN");
  try {
    for (const p of pieces) {
      if (p.keepsOriginal) {
        // The main body keeps the row, so activity history, photos, reminders and any
        // link anyone has shared still resolve to it.
        db.prepare("UPDATE districts SET boundary_geojson = ?, updated_at = ? WHERE id = ?")
          .run(JSON.stringify(p.geometry), now, row.id);
      } else {
        // Carries the status and group across: before the split both halves genuinely had
        // them, and silently resetting either would be a change nobody asked for.
        db.prepare(
          `INSERT INTO districts (name, level, parent_name, boundary_geojson, coverage_status, notes, is_custom, group_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(p.name, row.level, row.parent_name, JSON.stringify(p.geometry), row.coverage_status, row.notes, row.group_id, now);
        created++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

console.log(
  `\n${split} district(s) were really two places; ${apply ? `${created} new row(s) created` : "run again with --apply to fix"}.`
);
if (apply && created > 0) {
  // centroids and the geometry payload are both derived from boundary_geojson.
  console.log("Remember: restart the service so the geometry payload is rebuilt.");
}
db.close();
