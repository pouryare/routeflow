/** Saved pins (prospect locations). A pin belongs to one company and, within it, to the group that
 *  dropped it. Every lookup and write names the company: a pin with no group is reachable by any
 *  owner through the group rule alone, so the company is what keeps other tenants out. */

import { getDb, type LocationResolution, type SavedLocationRow } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";
import { tombstone } from "./tombstones";

type Sql = { sql: string; params: (string | number)[] };

export function locationsSignature(organizationId: number | null): { c: number; m: string | null } {
  const org = orgClause("organization_id", organizationId);
  return getDb().prepare(`SELECT COUNT(*) c, MAX(updated_at) m FROM saved_locations WHERE 1 = 1${org.sql}`).get(...org.params) as {
    c: number;
    m: string | null;
  };
}

export function searchLocations(q: string | undefined, filter: Sql, organizationId: number | null): SavedLocationRow[] {
  const org = orgClause("organization_id", organizationId);
  const db = getDb();
  return q
    ? (db
        .prepare(`SELECT * FROM saved_locations WHERE (name LIKE ? OR address LIKE ?)${filter.sql}${org.sql} ORDER BY created_at DESC`)
        .all(`%${q}%`, `%${q}%`, ...filter.params, ...org.params) as unknown as SavedLocationRow[])
    : (db
        .prepare(`SELECT * FROM saved_locations WHERE 1 = 1${filter.sql}${org.sql} ORDER BY created_at DESC`)
        .all(...filter.params, ...org.params) as unknown as SavedLocationRow[]);
}

export interface NewPin {
  name: string;
  mapsUrl: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  resolution: LocationResolution;
}

/** Inserts the pins in one transaction, skipping a maps_url the company already has. Returns how many were added. */
export function addLocations(pins: NewPin[], groupId: number | null, organizationId: number): number {
  const db = getDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO saved_locations (name, maps_url, address, lat, lng, resolution, group_id, created_at, updated_at, organization_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, maps_url) DO NOTHING
  `);
  let added = 0;
  db.exec("BEGIN");
  try {
    for (const p of pins) {
      const r = insert.run(p.name, p.mapsUrl, p.address, p.lat, p.lng, p.resolution, groupId, now, now, organizationId);
      if (r.changes > 0) added++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return added;
}

/** The group of one pin of this company, or undefined when absent or another tenant's. */
export function findOwnLocation(id: number, organizationId: number | null): { group_id: number | null } | undefined {
  const org = orgClause("organization_id", organizationId);
  return getDb().prepare(`SELECT group_id FROM saved_locations WHERE id = ?${org.sql}`).get(id, ...org.params) as
    | { group_id: number | null }
    | undefined;
}

/** `sets` are fixed `column = ?` fragments from the route. Returns false when no row changed. */
export function updateLocation(id: number, organizationId: number | null, sets: string[], values: (string | number | null)[]): boolean {
  const org = orgClause("organization_id", organizationId);
  const r = getDb()
    .prepare(`UPDATE saved_locations SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?${org.sql}`)
    .run(...values, new Date().toISOString(), id, ...org.params);
  return r.changes > 0;
}

export function deleteLocation(id: number, organizationId: number | null): boolean {
  const org = orgClause("organization_id", organizationId);
  const db = getDb();
  const row = db.prepare(`SELECT organization_id FROM saved_locations WHERE id = ?${org.sql}`).get(id, ...org.params) as
    | { organization_id: number | null }
    | undefined;
  const gone = db.prepare(`DELETE FROM saved_locations WHERE id = ?${org.sql}`).run(id, ...org.params).changes > 0;
  if (gone && row?.organization_id != null) tombstone(row.organization_id, "saved_locations", id, db);
  return gone;
}
