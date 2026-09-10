import type { CustomerRow, DistrictProperties } from "@/lib/types";

/** The map sidebar's worklist (item 27, spec slice L, direction A + C): with nothing
 *  selected, the panel lists what needs doing IN THE AREA ON SCREEN. Panning and zooming
 *  rewrite it, which is what turns the map from a viewer into a work surface.
 *
 *  Pure: customers, reminders, districts and the visible bounds in; three short lists out.
 *  CoverageMap supplies the bounds from Leaflet's moveend. */

export type Bounds = { south: number; west: number; north: number; east: number };

export type WorkReminder = {
  id: number;
  entity_type: "district" | "customer";
  entity_id: number;
  label: string;
  message: string;
};

export type Worklist = {
  /** Buying customers who have gone quiet, longest silence first. */
  quiet: { customer: CustomerRow; days: number | null }[];
  /** Reminders whose customer or district is on screen. */
  reminders: WorkReminder[];
  /** Districts marked as needing coverage whose centre is on screen. */
  uncovered: DistrictProperties[];
};

/** Silence long enough to be worth a visit. Matches the "inactivity" colour mode's
 *  first warning band on the map, so the list and the marker colours agree. */
export const QUIET_DAYS = 45;
export const WORKLIST_LIMIT = 6;

/** Only customers who have been buying: a lead that has never ordered is not "quiet",
 *  and a lost or blocked one is not a visit anybody should be sent on. */
const BUYING: ReadonlySet<string> = new Set(["active", "dormant"]);

export function inBounds(lat: number | null, lng: number | null, b: Bounds): boolean {
  if (lat === null || lng === null) return false;
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

const daysBetween = (fromIso: string, today: string) =>
  Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

export function buildWorklist(
  customers: CustomerRow[],
  reminders: WorkReminder[],
  districts: DistrictProperties[],
  bounds: Bounds,
  today: string,
  limit = WORKLIST_LIMIT,
): Worklist & { totals: { quiet: number; reminders: number; uncovered: number } } {
  const visible = customers.filter((c) => inBounds(c.lat, c.lng, bounds));
  const byId = new Map(customers.map((c) => [c.id, c]));
  const districtById = new Map(districts.map((d) => [d.id, d]));

  const quietAll = visible
    .filter((c) => BUYING.has(c.lifecycle))
    .map((c) => ({ customer: c, days: c.last_purchase_date ? daysBetween(c.last_purchase_date, today) : null }))
    /* Marked dormant counts whatever the date says; an active customer counts once the
       silence passes the threshold. An active one with no purchase date is not guessed at. */
    .filter((x) => x.customer.lifecycle === "dormant" || (x.days !== null && x.days >= QUIET_DAYS))
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity));

  const remindersAll = reminders.filter((r) => {
    if (r.entity_type === "customer") {
      const c = byId.get(r.entity_id);
      return c ? inBounds(c.lat, c.lng, bounds) : false;
    }
    const d = districtById.get(r.entity_id);
    return d ? inBounds(d.centroid_lat, d.centroid_lng, bounds) : false;
  });

  const uncoveredAll = districts.filter(
    (d) => d.coverage_status === "needs_coverage" && inBounds(d.centroid_lat, d.centroid_lng, bounds),
  );

  return {
    quiet: quietAll.slice(0, limit),
    reminders: remindersAll.slice(0, limit),
    uncovered: uncoveredAll.slice(0, limit),
    totals: { quiet: quietAll.length, reminders: remindersAll.length, uncovered: uncoveredAll.length },
  };
}
