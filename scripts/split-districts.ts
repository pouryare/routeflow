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
let skipped = 0;

// Add, never split. customers.district_id is a plain INTEGER foreign key, and the split
// below gives the largest piece the ORIGINAL row id while the new piece gets a fresh one.
// No customer is moved. So every customer in a split محله would keep the old classification
// even when they are geographically in the other half, and nothing re-derives them until
// someone edits that customer -- silent, and permanent.
//
// Before a seed this is a no-op; after one it is corruption. It is the same shape as the
// pin fold deleting a run stop mid-run (a98ae50) and the fourth FK referrer (d523fe3), and
// the reason the alternative is to ADD a district rather than divide one: an is_custom row
// nested inside an existing one wins on specificity, so nothing has to be renumbered.
const customersPerDistrict = new Map<number, number>(
  (db
    .prepare("SELECT district_id, COUNT(*) n FROM customers WHERE district_id IS NOT NULL GROUP BY district_id")
    .all() as unknown as { district_id: number; n: number }[]).map((r) => [r.district_id, r.n])
);

for (const row of rows) {
  let geometry: PolyGeometry;
  try {
    geometry = JSON.parse(row.boundary_geojson);
  } catch {
    continue;
  }
  const pieces = planSplit(row.name, geometry);
  if (!pieces) continue;

  // The refusal. Checked before the dry-run printout too, so a dry run tells an operator
  // the truth about what --apply would do rather than promising a split it will not perform.
  const referencing = customersPerDistrict.get(row.id) ?? 0;
  if (apply && referencing > 0) {
    skipped++;
    console.log(
      `\n${row.name} (id ${row.id}) -- SKIPPED, ${referencing} customer(s) point at it. ` +
        `Splitting would leave them classified into the wrong half. Add a district for the ` +
        `other place instead (scripts/assign-district-codes.ts will code it).`
    );
    continue;
  }

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

// Silent is the failure mode this whole script is about, so a refused split is reported
// with the same weight as a performed one. An operator who ran --apply and saw only
// "0 new rows" would have no idea a split had been declined and why.
console.log(
  `\n${split} district(s) were really two places; ` +
    `${apply ? `${created} new row(s) created` : "run again with --apply to fix"}` +
    `${skipped ? `; ${skipped} skipped because customers point at them (add a district instead)` : ""}.`
);
if (apply && created > 0) {
  // centroids and the geometry payload are both derived from boundary_geojson.
  console.log("Remember: restart the service so the geometry payload is rebuilt.");
}
db.close();
