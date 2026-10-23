import type { Db } from "@/lib/database/client";
import { getDb, type SavedLocationRow } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";

/** Reads over the lead pool -- the pins in saved_locations.
 *
 *  Its own module because these are the pool, not a route: the map page, the visit route and
 *  the run planner all need a pin, and none of them should be holding SQL. lib/repo/ is where
 *  queries live; tests/repo-boundary.test.ts is what keeps them there.
 */

/** The pin a visit is being recorded against, or null. */
/** One pin of this company (`organizationId` null = every company, platform owner only). A pin with no
 *  group is reachable by any owner through the group rule alone, so the company is part of the lookup. */
export async function readLeadLocation(locationId: number, organizationId: number | null): Promise<SavedLocationRow | null> {
  const org = orgClause("organization_id", organizationId);
  return (await getDb().prepare(`SELECT * FROM saved_locations WHERE id = ?${org.sql}`).get(locationId, ...org.params) as SavedLocationRow | undefined) ?? null;
}

/** Which group owns a pin, for the reachability check that happens before the row is read. */
export async function readLeadLocationGroup(conn: Db, locationId: number): Promise<{ group_id: number | null } | null> {
  return (await conn.prepare("SELECT group_id FROM saved_locations WHERE id = ?").get(locationId) as { group_id: number | null }) ?? null;
}

export interface LeadPin {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

/** Every pin with coordinates, newest first, for the coverage map.
 *
 *  Scoped to the organisation, but NOT by group on purpose, and the caller filters: the map draws a pin for each
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
export async function readLeadPins(conn: Db, organizationId: number | null): Promise<LeadPin[]> {
  const org = orgClause("organization_id", organizationId);
  return (
    await conn
      .prepare(`SELECT id, name, lat, lng FROM saved_locations WHERE lat IS NOT NULL AND lng IS NOT NULL${org.sql} ORDER BY created_at DESC`)
      .all(...org.params) as unknown as Array<LeadPin>
  ).map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng }));
}
