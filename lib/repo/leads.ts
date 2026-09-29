import type { DatabaseSync } from "node:sqlite";
import type { SavedLocationRow } from "@/lib/db";

/** Reads over the lead pool -- the pins in saved_locations.
 *
 *  Its own module because these are the pool, not a route: the map page, the visit route and
 *  the run planner all need a pin, and none of them should be holding SQL. lib/repo/ is where
 *  queries live; tests/repo-boundary.test.ts is what keeps them there.
 */

/** The pin a visit is being recorded against, or null. */
export function readLeadLocation(conn: DatabaseSync, locationId: number): SavedLocationRow | null {
  return (conn.prepare("SELECT * FROM saved_locations WHERE id = ?").get(locationId) as SavedLocationRow | undefined) ?? null;
}

/** Which group owns a pin, for the reachability check that happens before the row is read. */
export function readLeadLocationGroup(conn: DatabaseSync, locationId: number): { group_id: number | null } | null {
  return (conn.prepare("SELECT group_id FROM saved_locations WHERE id = ?").get(locationId) as { group_id: number | null }) ?? null;
}

export interface LeadPin {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

/** Every pin with coordinates, newest first, for the coverage map.
 *
 *  Unscoped by group on purpose, and the caller filters: the map draws a pin for each
 *  district the session can see, and a pin outside every visible district is never plotted.
 *  Filtering here instead would need the caller's group list threaded through, and would put
 *  the visibility rule in two places.
 *
 *  MAPPED TO PLAIN OBJECTS, and this is load-bearing rather than tidy. node:sqlite returns
 *  rows with a null prototype, and React refuses those across the server→client boundary:
 *  "Only plain objects, and a few built-ins, can be passed to Client Components". The map
 *  page hands this array to a client component, so the raw rows threw on every load — a
 *  total outage of /map that no unit test could see, because the rows are perfectly valid
 *  TypeScript. Caught only by tests/smoke/console.test.ts, which is exactly what it is for. */
export function readLeadPins(conn: DatabaseSync): LeadPin[] {
  return (
    conn
      .prepare("SELECT id, name, lat, lng FROM saved_locations WHERE lat IS NOT NULL AND lng IS NOT NULL ORDER BY created_at DESC")
      .all() as unknown as Array<LeadPin>
  ).map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng }));
}
