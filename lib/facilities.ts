// Our own fixed sites -- the depots stock is dispatched from -- as opposed to customers
// (imported from the workbook), leads (pasted links) or districts (coverage polygons).
//
// These began life as a hard-coded constant, which was right while there were exactly
// two of them and only a developer could change them. They are now rows the user owns:
// they can add a third site, rename one, reposition a pin, or delete one, and every
// distance the app computes follows. The seed that put the original two in the table
// lives in lib/db.ts alongside the schema.
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import type { FacilityKind, FacilityRow } from "./facilityTypes";

// Server-side callers get everything from one import; client code must import the
// constants from ./facilityTypes directly, since importing a value from this module
// pulls node:sqlite into the bundle. See the header of lib/facilityTypes.ts.
export type { FacilityKind, FacilityRow };
export { FACILITY_COLOR, FACILITY_LABEL, FACILITY_KINDS } from "./facilityTypes";

// Home base first: it is the origin every delivery run starts from, so it leads the
// sidebar list, the editor and the map legend. Warehouses next, everything else last.
const KIND_ORDER: Record<FacilityKind, number> = {
  home: 0,
  warehouse: 1,
  factory: 2,
  cold_storage: 3,
  parking: 4,
  office: 5,
  shop: 6,
  van: 7,
  other: 8,
};

/** node:sqlite hands back rows with a null prototype. JSON.stringify doesn't care, so
 *  the API route never had to, but React refuses to pass one across the server/client
 *  boundary -- and the server-rendered map page passes this list straight into a Client
 *  Component. Rebuilding each row as an object literal is also the explicit column
 *  list, so the page and the API can't drift apart in what they send. Same reasoning as
 *  readCustomers in lib/customers.ts. */
export function readFacilities(
  db: DatabaseSync = getDb(),
  /** SQL fragment + params from groupFilterWithShared(). Facilities with no group are
   *  company-wide (the seeded warehouse and home origin), so they stay visible to every
   *  group rather than being scoped away. */
  scope: { sql: string; params: number[] } = { sql: "", params: [] }
): FacilityRow[] {
  const rows = db
    .prepare(`SELECT * FROM facilities WHERE 1 = 1${scope.sql}`)
    .all(...scope.params) as unknown as FacilityRow[];
  return rows
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      kind: r.kind,
      name: r.name,
      icon_key: r.icon_key,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      maps_url: r.maps_url,
      notes: r.notes,
      is_default_origin: r.is_default_origin,
      owner_username: r.owner_username,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }))
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, "fa"));
}

/** One site by id, rebuilt as a plain object for the same null-prototype reason as
 *  readFacilities. Used where a caller needs the whole row rather than a single column
 *  -- notably DELETE, which hands the deleted row back so the action can be undone. */
export function readFacility(db: DatabaseSync, id: number): FacilityRow | null {
  return readFacilities(db).find((f) => f.id === id) ?? null;
}

/** Defined in facilityTypes.ts, not here: CoverageMap is a Client Component and cannot
 *  import a value from this module without dragging node:sqlite into its bundle. */
export { isPlaced, pickOrigin } from "./facilityTypes";
import { pickOrigin } from "./facilityTypes";

export function homeBase(db: DatabaseSync = getDb()): FacilityRow | null {
  return readFacilities(db).find((f) => f.kind === "home") ?? null;
}

/** One person's own home, if they have set one up.
 *
 *  `owner_username` has been on the table since the column was added and nothing has ever
 *  read it. It exists so that giving each driver their own starting point would be a query
 *  change rather than a migration against a table already holding real data -- which is
 *  this function.
 *
 *  Null is the normal answer and not an error: most tenants never enter a house, because
 *  their drivers all start at the depot. A business where the founder works from home is
 *  the exception that needs it, not the rule. */
export function homeOf(organizationId: number, username: string, db: DatabaseSync = getDb()): FacilityRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM facilities
          WHERE organization_id = ? AND owner_username = ? AND kind = 'home'`
      )
      .get(organizationId, username) as FacilityRow | undefined) ?? null
  );
}

export function mainWarehouse(db: DatabaseSync = getDb()): FacilityRow | null {
  return readFacilities(db).find((f) => f.kind === "warehouse") ?? null;
}

/** The point every distance in the app is measured from unless something more specific
 *  is in play (a GPS fix, or a per-day override on the planner).
 *
 *  Falls back through the home base to the first placed site rather than returning null
 *  when no row carries the flag: a database in that state -- a bad restore, a future bug --
 *  should still render distances from a sensible point instead of stranding every reading
 *  in the app. A site with no location is not a sensible point, so it is not a candidate. */
export function defaultOrigin(db: DatabaseSync = getDb()): FacilityRow | null {
  return pickOrigin(readFacilities(db));
}
