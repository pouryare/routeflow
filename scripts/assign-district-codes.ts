// One-time setup: give every district its short code, and every محله its west-to-east
// ordinal within its منطقه.
//
//   node --experimental-strip-types scripts/assign-district-codes.ts [--dry-run]
//
// Separate from the seeds on purpose. A code written during seeding would be recomputed on
// every re-run, so a split would renumber existing districts and every printed route sheet
// would silently point somewhere else. `WHERE code IS NULL` makes this pass idempotent
// instead: it fills what is missing and never touches what exists.
//
// Dry-run by default, like scripts/split-districts.ts, because it writes to rows a rep has
// already seen. Pass --apply to write.
//
// Opens SQLite directly rather than through lib/db.ts: this is a data pass, not a boot, and
// lib/db.ts pulls in the rest of the app, which Node's type stripping cannot resolve
// without a bundler. Same reason, same fix, as the three seed scripts.
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codeForMantaghe, mahalleCode, orderedMahalle, parentNoFromName } from "../lib/districtCodes.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(ROOT, "data", "routeflow.db");
const apply = process.argv.includes("--apply");

const db = new DatabaseSync(DB_PATH);

interface Row {
  id: number;
  name: string;
  level: string;
  parent_name: string;
  code: string | null;
  parent_no: number | null;
  boundary_geojson: string;
}

const rows = db
  .prepare("SELECT id, name, level, parent_name, code, parent_no, boundary_geojson FROM districts ORDER BY id")
  .all() as unknown as Row[];

if (rows.length === 0) {
  console.error("districts is empty — run the three seed scripts first.");
  process.exit(1);
}

// The first vertex is enough to place a polygon on the west-east axis, and it is the same
// rule everywhere else in this repo (lib/groups.ts takes the first ring, and the centroid
// backfill at lib/db.ts:3021 does the same). A full centroid is nicer but adds a
// dependency this pass does not otherwise need.
function firstVertex(geojson: string): { lng: number; lat: number } | null {
  try {
    // Narrowed rather than cast: the ring is the first element of coordinates[0] for a
    // Polygon, and the first element of the first polygon for a MultiPolygon. Casting the
    // whole thing as number[][][] made the two branches look alike to the compiler while
    // they are different depths, and indexing a number[]|number[][] union is an error.
    const g = JSON.parse(geojson) as { type: string; coordinates: unknown };
    const first = g.coordinates as unknown[] | undefined;
    if (!Array.isArray(first) || first.length === 0) return null;
    const ring = (g.type === "Polygon" ? first[0] : (first[0] as unknown[])?.[0]) as
      | [number, number][]
      | undefined;
    if (!Array.isArray(ring) || ring.length === 0) return null;
    const p = ring[0];
    return { lng: p[0], lat: p[1] };
  } catch {
    return null;
  }
}

const updates: { id: number; code: string; what: string }[] = [];

// ---- top level: 22 منطقه (their own number), 34 بخش (B + ordinal), 7 towns (T + ordinal)
const topLevel = rows.filter((r) => r.level === "mantaghe");
const bakhsh = topLevel.filter((r) => r.name.startsWith("بخش"));
// The 7 outer towns are stored at level='mahalle' (the CHECK allows only mantaghe|mahalle)
// but are not محله: they carry a شهرستان parent. Distinguishing them by that parent is
// what keeps a town from being numbered as if it were a neighbourhood.
const TOWN_PARENT = /^شهرستان /;

for (const r of topLevel) {
  if (r.code) continue;
  if (r.name.startsWith("بخش")) {
    updates.push({ id: r.id, code: codeForMantaghe(null, r.name, bakhsh.indexOf(r) + 1), what: r.name });
  } else {
    updates.push({ id: r.id, code: codeForMantaghe(parentNoFromName(r.name), r.name), what: r.name });
  }
}
for (const r of rows.filter((r) => r.level === "mahalle" && TOWN_PARENT.test(r.parent_name ?? ""))) {
  if (r.code) continue;
  updates.push({ id: r.id, code: codeForMantaghe(null, r.name), what: `${r.name} (town)` });
}

// ---- محله: parent number + west-to-east ordinal within the parent
const byParent = new Map<number, { name: string; lng: number; lat: number; id: number }[]>();
let uncodedParents = 0;
const orphanNames: string[] = [];

for (const r of rows) {
  if (r.level !== "mahalle" || TOWN_PARENT.test(r.parent_name ?? "")) continue;
  if (r.code) continue;
  const p = parentNoFromName(r.parent_name ?? "");
  if (p === null) { uncodedParents++; orphanNames.push(r.name); continue; }
  const v = firstVertex(r.boundary_geojson);
  if (!v) continue;
  const list = byParent.get(p) ?? [];
  list.push({ name: r.name, lng: v.lng, lat: v.lat, id: r.id });
  byParent.set(p, list);
}

for (const [parentNo, list] of [...byParent.entries()].sort((a, b) => a[0] - b[0])) {
  orderedMahalle(list).forEach((m, i) => {
    updates.push({ id: m.id, code: mahalleCode(parentNo, i + 1), what: `${m.name} (منطقه ${parentNo})` });
  });
}

if (uncodedParents > 0) {
  console.log(`${uncodedParents} محله have a parent name with no number — left uncoded and listed:`);
  for (const n of orphanNames.slice(0, 20)) console.log(`   ${n}`);
  if (orphanNames.length > 20) console.log(`   ... and ${orphanNames.length - 20} more`);
}

// parent_no alongside the code, in the same pass, so the two never disagree. It is what
// makes the 369 محله resolvable to their منطقه without re-deriving the number from a name
// that two source files spell differently. Written with the same WHERE-is-NULL guard, so
// this is as idempotent as the codes.
const parentUpdates: { id: number; parentNo: number | null; what: string }[] = [];
// 0, not NULL, when a district names no number. A بخش (34 of them) and an outer town (7)
// legitimately have none, and leaving those NULL meant `parent_no IS NULL` selected them
// again on every run -- so the script could never report a clean no-op, which is the one
// signal that says the codes are stable. 0 is falsy in the reading code and carries the
// same meaning as "this district is not inside a numbered mantaghe".
for (const r of rows) {
  if (r.parent_no !== null) continue;
  const source = r.level === "mahalle" ? r.parent_name : r.name;
  parentUpdates.push({ id: r.id, parentNo: parentNoFromName(source ?? "") ?? 0, what: r.name });
}

if (updates.length === 0 && parentUpdates.length === 0) {
  console.log(`nothing to do — all ${rows.length} districts already have a code and a parent_no`);
  db.close();
  process.exit(0);
}

// A collision would mean the ordinal is not a function of the geometry, which
// tests/districtCodes.test.ts asserts it is. Abort rather than write a duplicate that the
// unique index would reject halfway through the transaction anyway.
const seen = new Map<string, { id: number; what: string }>();
for (const u of updates) {
  const prev = seen.get(u.code);
  if (prev !== undefined) {
    console.error(`ABORT: ${u.code} would go to two districts — ${prev.what} (id ${prev.id}) and ${u.what} (id ${u.id}).`);
    console.error("Nothing was written. Fix the ordering rule rather than the index.");
    db.close();
    process.exit(1);
  }
  seen.set(u.code, { id: u.id, what: u.what });
}

const unmapped = updates.filter((u) => u.code.startsWith("X"));
if (unmapped.length) {
  console.log(`${unmapped.length} district(s) fell back to X<index> and need a real code:`);
  for (const u of unmapped) console.log(`   ${u.what}`);
}

console.log(`${apply ? "assigning" : "would assign"} ${updates.length} code(s) across ${rows.length} districts:`);
for (const u of updates.slice(0, 30)) console.log(`   ${u.code.padEnd(6)} ${u.what}`);
if (updates.length > 30) console.log(`   ... and ${updates.length - 30} more`);
// The code list alone is not the whole job: parent_no may still be unset even when every
// code is in place, which is exactly the state this script was in after its first run.
if (updates.length === 0) console.log("   (codes already in place; nothing to number)");

if (!apply) {
  console.log(`\n${parentUpdates.length} parent_no would also be set.`);
  console.log("dry run — pass --apply to write");
} else {
  // WHERE ... IS NULL is the whole idempotence guarantee: a second run selects nothing.
  const upd = db.prepare("UPDATE districts SET code = ? WHERE id = ? AND code IS NULL");
  const updParent = db.prepare("UPDATE districts SET parent_no = ? WHERE id = ? AND parent_no IS NULL");
  db.exec("BEGIN");
  try {
    for (const u of updates) upd.run(u.code, u.id);
    for (const p of parentUpdates) updParent.run(p.parentNo, p.id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const total = db.prepare("SELECT COUNT(*) c FROM districts WHERE code IS NOT NULL").get() as { c: number };
  const withParent = db.prepare("SELECT COUNT(*) c FROM districts WHERE parent_no IS NOT NULL").get() as { c: number };
  console.log(`\n${total.c} of ${rows.length} districts now have a code`);
  console.log(`${withParent.c} of ${rows.length} now have a parent_no (0 = a بخش or town, which names no number)`);
}
db.close();
