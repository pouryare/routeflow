// One-time setup: point every located pin and customer at its district.
//
//   node --experimental-strip-types scripts/backfill-districts.ts [--apply]
//
// A script and not a boot migration, deliberately. lib/db.ts carries a rule that
// tests/no-one-shot-data-migration.test.ts enforces: a data-dependent migration may not sit
// behind an app_meta marker, because a row arriving after the marker was written would wait
// forever. This backfill's predicate is about rows, so it belongs out here, run once, in
// order, deliberately -- and dry-run by default, like scripts/split-districts.ts, because it
// writes to rows a rep has already looked at.
//
// Opens SQLite directly rather than through lib/db.ts: a data pass is not a boot, and
// lib/db.ts pulls in the rest of the app, which Node's type stripping cannot resolve without
// a bundler. Same reason, and the same fix, as the three seed scripts.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pointInRing } from "../lib/trafficZones.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
const apply = process.argv.includes("--apply");

const db = new DatabaseSync(DB_PATH);

interface D { id: number; boundary_geojson: string }
/** The same ORDER BY districtIdForPoint uses (lib/groups.ts:52). Two copies of this rule
 *  drifting apart is exactly the bug tests/district-custom-precedence.test.ts guards: a
 *  backfill and the running app would classify one point two different ways. */
const districts = db
  .prepare(
    `SELECT id, boundary_geojson FROM districts
      ORDER BY is_custom DESC, CASE level WHEN 'mahalle' THEN 0 ELSE 1 END, id`
  )
  .all() as unknown as D[];

if (districts.length === 0) {
  console.error("districts is empty — run the three seed scripts and assign-district-codes.ts first.");
  process.exit(1);
}

function outerRings(geojson: string): [number, number][][] {
  try {
    const p = JSON.parse(geojson) as { type?: string; coordinates?: unknown };
    if (p.type === "Polygon") return p.coordinates as [number, number][][];
    if (p.type === "MultiPolygon") return (p.coordinates as [number, number][][][]).map((x) => x[0]);
    return [];
  } catch {
    return [];
  }
}
const prepared = districts.map((d) => ({ id: d.id, rings: outerRings(d.boundary_geojson) }));

function districtFor(lat: number, lng: number): number | null {
  for (const d of prepared) for (const ring of d.rings) if (pointInRing(lng, lat, ring)) return d.id;
  return null;
}

interface Row { id: number; label: string; lat: number | null; lng: number | null; district_id: number | null }

// customers only. saved_locations has NO district_id column -- the pins are the raw
// Google Maps drops, and a pin becomes a district-bearing customer when
// promoteLeadToCustomer copies its lat/lng across (lib/repo/crm/conversion.ts). Backfilling
// a column that does not exist would have meant adding one, and a second copy of the
// location that customers.district_id already derives from. The 25 pins are therefore not
// a backfill target at all: they are classified the moment they are promoted, and again by
// setLocation on every later write.
const targets: { table: string; rows: Row[] }[] = [
  { table: "customers", rows: db.prepare("SELECT id, business_name AS label, lat, lng, district_id FROM customers").all() as unknown as Row[] },
];

let set = 0, unchanged = 0, noCoords = 0, matchedNothing = 0;
const unresolved: string[] = [];
const applied: { table: string; id: number; next: number }[] = [];

db.exec("BEGIN");
try {
  for (const { table, rows } of targets) {
    const upd = db.prepare(`UPDATE ${table} SET district_id = ? WHERE id = ?`);
    for (const r of rows) {
      if (r.lat === null || r.lng === null) {
        noCoords++;
        unresolved.push(`${table}#${r.id} ${r.label} (no coordinates)`);
        continue;
      }
      const next = districtFor(r.lat, r.lng);
      if (next === null) {
        matchedNothing++;
        unresolved.push(`${table}#${r.id} ${r.label} (matches no district)`);
        continue;
      }
      if (next === r.district_id) { unchanged++; continue; }
      if (apply) { upd.run(next, r.id); applied.push({ table, id: r.id, next }); }
      set++;
    }
  }
  if (apply) db.exec("COMMIT"); else db.exec("ROLLBACK");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(`${apply ? "set" : "would set"} district_id on ${set} row(s); ${unchanged} already correct`);
if (unresolved.length) {
  console.log(`\n${unresolved.length} row(s) left NULL (${noCoords} without coordinates, ${matchedNothing} matching no district), and why:`);
  for (const u of unresolved) console.log(`   ${u}`);
  console.log("\nA row with no location has no district. That is the honest answer -- guessing");
  console.log("one from a text address would be a guess wearing a foreign key.");
}
if (apply && applied.length) {
  const counts = new Map<number, number>();
  for (const a of applied) counts.set(a.next, (counts.get(a.next) ?? 0) + 1);
  const rows = db
    .prepare(
      `SELECT id, name, code FROM districts WHERE id IN (${[...counts.keys()].map(() => "?").join(",")})`
    )
    .all(...counts.keys()) as { id: number; name: string; code: string }[];
  console.log(`\n${rows.length} district(s) received a row:`);
  for (const d of rows.sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))) {
    console.log(`   ${d.code.padEnd(6)} ${d.name}  x${counts.get(d.id)}`);
  }
}
if (!apply) console.log("\ndry run -- pass --apply to write");
db.close();
