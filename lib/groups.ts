import type { DatabaseSync } from "node:sqlite";
import { pointInRing } from "./trafficZones";
import type { GroupRow } from "./db";

export function readGroups(db: DatabaseSync, organizationId: number): GroupRow[] {
  return db
    .prepare("SELECT * FROM groups WHERE organization_id = ? ORDER BY name")
    .all(organizationId) as unknown as GroupRow[];
}

interface DistrictShape {
  id: number;
  level: string;
  group_id: number | null;
  boundary_geojson: string;
}

/** Outer rings of a Polygon or MultiPolygon, in GeoJSON [lng, lat] order.
 *
 *  Holes are ignored. The Tehran dataset has none, and if one appeared the effect would
 *  be a customer counted as inside a district they are technically outside -- which
 *  leaves them in the right group's hands to correct, rather than silently ungrouped. */
function outerRings(geojson: string): [number, number][][] {
  let parsed: { type?: string; coordinates?: unknown };
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return [];
  }
  if (parsed.type === "Polygon") {
    const rings = parsed.coordinates as [number, number][][] | undefined;
    return rings?.[0] ? [rings[0]] : [];
  }
  if (parsed.type === "MultiPolygon") {
    const polys = parsed.coordinates as [number, number][][][] | undefined;
    return (polys ?? []).map((p) => p[0]).filter(Boolean);
  }
  return [];
}

/** The district whose boundary contains the point, or null.
 *
 *  Two rules, in this order:
 *
 *  1. **A hand-drawn district wins.** `is_custom DESC` first, because a boundary an
 *     operator drew is a deliberate, finer statement about a place and must beat the
 *     coarse administrative polygon underneath it. This is not cosmetic: a بخش is stored
 *     at level='mantaghe' -- the same level a drawn district gets, since the CHECK allows
 *     only those two values -- so without is_custom the ordering fell through to `id` and
 *     the custom district, always inserted after the seeds, always lost. Every boundary an
 *     operator drew would have been silently ignored, while the point still matched
 *     something so nothing ever errored. That is the whole "add, never split" rule working:
 *     a new place is added as a nested district precisely because it beats its parent.
 *
 *  2. **Finer before coarser.** Every محله sits inside a منطقه, so a point inside one is
 *     inside both, and territory is assigned at the finer level. Testing coarse-first
 *     would hand every point to the enclosing منطقه and make neighbourhood assignment
 *     meaningless.
 *
 *  recomputeCustomerGroups below carries the identical ORDER BY and must keep doing so: if
 *  the two drift, a backfill and the running app classify the same point two different
 *  ways, which is worse than either being wrong on its own.
 */
export function districtIdForPoint(db: DatabaseSync, lat: number, lng: number): number | null {
  const rows = db
    .prepare(
      `SELECT id, level, group_id, boundary_geojson FROM districts
       ORDER BY is_custom DESC, CASE level WHEN 'mahalle' THEN 0 ELSE 1 END, id`
    )
    .all() as unknown as DistrictShape[];

  for (const row of rows) {
    for (const ring of outerRings(row.boundary_geojson)) {
      if (pointInRing(lng, lat, ring)) return row.id;
    }
  }
  return null;
}

export function groupForPoint(db: DatabaseSync, lat: number, lng: number): number | null {
  const id = districtIdForPoint(db, lat, lng);
  if (id === null) return null;
  const row = db.prepare("SELECT group_id FROM districts WHERE id = ?").get(id) as { group_id: number | null } | undefined;
  return row?.group_id ?? null;
}

/** Rebuilds customers.group_id from territory. Call after any change to district→group
 *  assignment and after every customer import.
 *
 *  Loads the geometry once and walks the customers against it, rather than calling
 *  groupForPoint per customer: that would re-read ~600KB of boundary_geojson 300 times.
 *  Returns the number of rows whose group actually changed.
 */
export function recomputeCustomerGroups(db: DatabaseSync): number {
  const districts = db
    .prepare(
      `SELECT id, level, group_id, boundary_geojson FROM districts
       ORDER BY is_custom DESC, CASE level WHEN 'mahalle' THEN 0 ELSE 1 END, id`
    )
    .all() as unknown as DistrictShape[];

  const prepared = districts.map((d) => ({ group_id: d.group_id, rings: outerRings(d.boundary_geojson) }));

  const customers = db
    .prepare("SELECT id, lat, lng, group_id FROM customers")
    .all() as unknown as { id: number; lat: number | null; lng: number | null; group_id: number | null }[];

  const update = db.prepare("UPDATE customers SET group_id = ? WHERE id = ?");
  let changed = 0;

  db.exec("BEGIN");
  try {
    for (const c of customers) {
      let next: number | null = null;
      if (c.lat !== null && c.lng !== null) {
        outer: for (const d of prepared) {
          for (const ring of d.rings) {
            if (pointInRing(c.lng, c.lat, ring)) {
              next = d.group_id;
              break outer;
            }
          }
        }
      }
      if (next !== c.group_id) {
        update.run(next, c.id);
        changed++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return changed;
}
