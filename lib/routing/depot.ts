// Where stock comes from, and where a day starts from.
//
// This is the ONLY module allowed to decide which facility is the origin. That is not
// tidiness: eleven call sites used to each answer some version of the question, and they
// could disagree -- one ordered by the flag, another by "the lowest id", a third by "the
// first row". When a tenant's answer changed, they changed in different places.
//
// The two readers that disagreed, and how:
//   - this question, for DISTANCES, fell through flag -> home base -> first placed place.
//   - the same question, for STOCK, was `kind = 'warehouse'` first -> flag -> lowest id.
//
// A business whose house is the depot -- which is one of the two arrangements the owner
// described -- gets a different answer from each. See pickDepot below.

import { getDb } from "@/lib/db";
import type { LatLng } from "@/lib/geo";
import { isPlaced, pickOrigin, type FacilityRow } from "@/lib/facilityTypes";

/** A facility that can be loaded from and driven out of. Must have a location -- a van
 *  cannot be dispatched from Null Island, which is where "no location" used to point. */
export type Depot = FacilityRow & { lat: number; lng: number };

/** The place a day starts from and stock is loaded from.
 *
 *  Flag first, then any warehouse, then any place at all -- each step filtered to places that
 *  actually HAVE a location. Deliberately NOT "the home base": that assumed the company has
 *  one, and the arrangement where the founder's house is the depot has none that means what
 *  the word means.
 *
 *  Throws rather than returning null when there is nothing usable. Every caller needs an
 *  answer before it can do anything useful, and a null here becomes a null map pin or an
 *  unplaced stock movement three frames deeper. The message names the fix. */
export function pickDepot(organizationId: number): Depot {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM facilities WHERE organization_id = ? ORDER BY is_default_origin DESC, id ASC`
    )
    .all(organizationId) as unknown as FacilityRow[];
  const found =
    rows.find((f) => f.is_default_origin === 1 && isPlaced(f)) ??
    rows.find((f) => f.kind === "warehouse" && isPlaced(f)) ??
    rows.find(isPlaced);
  if (!found || !isPlaced(found)) {
    throw new Error("مکانی برای شروع مسیر تعریف نشده است");
  }
  return found as Depot;
}

/** The origin as a bare coordinate, for the many functions that take a `LatLng`. Null when
 *  there is none, because those callers have their own "no origin" behaviour already and
 *  inventing one for them would hide the difference between "no origin chosen" and
 *  "origin is here". */
export function depotFor(organizationId: number): LatLng | null {
  try {
    const d = pickDepot(organizationId);
    return { lat: d.lat, lng: d.lng };
  } catch {
    return null;
  }
}

/** The origin from an already-read list, for callers that have one in hand.
 *
 *  `pickOrigin` in facilityTypes is the same ranking with a `home_base` step in the middle,
 *  because a map has no opinion about stock. Keeping both means the flag question is asked
 *  in two places and not eleven -- and when they must diverge, the divergence is visible
 *  here rather than scattered. */
export function originFrom(facilities: readonly FacilityRow[]): Depot | null {
  const placed = facilities.filter(isPlaced);
  return (
    (placed.find((f) => f.is_default_origin === 1) ??
      placed.find((f) => f.kind === "warehouse") ??
      pickOrigin(placed)) as Depot | null
  );
}