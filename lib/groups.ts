import type { DatabaseSync } from "node:sqlite";
import { pointInRing } from "./trafficZones";
import type { GroupRow } from "./db";
import { recordOwnerChange } from "./repo/crm/ownerChange";

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
/** The order a point is classified in: a hand-drawn district first, then the finer level, then
 *  id. ONE definition, used by every query that classifies a point, so the backfill and the
 *  running app can never disagree about which district a point is in. */
const DISTRICT_PRECEDENCE_SQL = "d.is_custom DESC, CASE d.level WHEN 'mahalle' THEN 0 ELSE 1 END, d.id";

export function districtIdForPoint(db: DatabaseSync, lat: number, lng: number): number | null {
  const rows = db
    .prepare(
      `SELECT d.id, d.level, d.group_id, d.boundary_geojson FROM districts d
       ORDER BY ${DISTRICT_PRECEDENCE_SQL}`
    )
    .all() as unknown as DistrictShape[];

  for (const row of rows) {
    for (const ring of outerRings(row.boundary_geojson)) {
      if (pointInRing(lng, lat, ring)) return row.id;
    }
  }
  return null;
}

/** The districts one organisation can be assigned territory from, in the order a point is
 *  classified: custom first, then mahalle before mantaghe, then id.
 *
 *  Districts are shared geography (every organisation sees the same polygons) but a claim is
 *  not shared: `group_id` points at a group, and a group belongs to ONE organisation. A
 *  district claimed by somebody else's group is not this organisation's territory, so it is
 *  left out here. Unclaimed districts stay in, because a customer in an unclaimed polygon
 *  correctly ends up in no group. Without this filter, a customer of company B standing in
 *  a district company A claimed was handed A's group, and A's manager then saw B's customer. */
function districtsFor(db: DatabaseSync, organizationId: number): DistrictShape[] {
  return db
    .prepare(
      `SELECT d.id, d.level, d.group_id, d.boundary_geojson
         FROM districts d LEFT JOIN groups g ON g.id = d.group_id
        WHERE d.group_id IS NULL OR g.organization_id = ?
        ORDER BY ${DISTRICT_PRECEDENCE_SQL}`
    )
    .all(organizationId) as unknown as DistrictShape[];
}

export function groupForPoint(db: DatabaseSync, lat: number, lng: number, organizationId: number): number | null {
  for (const row of districtsFor(db, organizationId)) {
    for (const ring of outerRings(row.boundary_geojson)) {
      if (pointInRing(lng, lat, ring)) return row.group_id;
    }
  }
  return null;
}

/** Rebuilds customers.group_id from territory. Call after any change to district→group
 *  assignment and after every customer import.
 *
 *  Loads the geometry once and walks the customers against it, rather than calling
 *  groupForPoint per customer: that would re-read ~600KB of boundary_geojson 300 times.
 *  Returns the number of rows whose group actually changed.
 */
export function recomputeCustomerGroups(db: DatabaseSync, organizationId: number | null): number {
  /* null is the platform_owner's "every tenant": each organisation is recomputed against its
     OWN territory, never against the pooled set, so one company's edit cannot regroup
     another's customers. */
  if (organizationId === null) {
    const orgs = db.prepare("SELECT id FROM organizations").all() as unknown as { id: number }[];
    return orgs.reduce((total, o) => total + recomputeCustomerGroups(db, o.id), 0);
  }
  const districts = districtsFor(db, organizationId);

  const prepared = districts.map((d) => ({ group_id: d.group_id, rings: outerRings(d.boundary_geojson) }));

  const customers = db
    .prepare("SELECT id, lat, lng, group_id FROM customers WHERE organization_id = ?")
    .all(organizationId) as unknown as { id: number; lat: number | null; lng: number | null; group_id: number | null }[];

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
        recordOwnerChange(db, {
          organizationId,
          customerId: c.id,
          actorUserId: null,
          reason: "territory",
          what: "group",
          fromId: c.group_id,
          toId: next,
        });
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
