/** Sites (warehouses, vans, home bases) as the manage screens write them. Every statement that
 *  names a row also names its company, so an id from another tenant matches nothing. */

import { getDb } from "@/lib/db";
import { readFacility, type FacilityRow } from "@/lib/facilities";
import { orgClause } from "@/lib/orgScope";
import { tombstone } from "./tombstones";

/** Cheap change signature for the list's ETag: COUNT + MAX(updated_at). updated_at is what makes
 *  a pin move invalidate the tag. Scoped, so one company's edits do not bust another's cache. */
export async function facilitiesSignature(organizationId: number | null): Promise<{ c: number; m: string | null }> {
  const org = orgClause("organization_id", organizationId);
  return await getDb().prepare(`SELECT COUNT(*) c, MAX(updated_at) m FROM facilities WHERE 1 = 1${org.sql}`).get(...org.params) as {
    c: number;
    m: string | null;
  };
}

/** Which parts of a requested restore are still available: null when the id has been taken
 *  (an undo that overwrote whatever now holds it would be worse than landing on a new id). */
export async function resolveRestore(wanted: { id?: number; slug?: string } | undefined): Promise<{ id: number; slug?: string } | null> {
  if (!wanted || !Number.isInteger(wanted.id)) return null;
  const db = getDb();
  const id = wanted.id as number;
  if (await db.prepare("SELECT 1 FROM facilities WHERE id = ?").get(id)) return null;
  if (typeof wanted.slug === "string" && wanted.slug) {
    // Slugs are unique per company; a different company's slug is no obstacle.
    if (!await db.prepare("SELECT 1 FROM facilities WHERE slug = ?").get(wanted.slug)) return { id, slug: wanted.slug };
  }
  return { id };
}

export interface NewFacility {
  restoreId: number | null;
  slug: string;
  kind: string;
  name: string;
  iconKey: string;
  address: string | null;
  lat: number;
  lng: number;
  mapsUrl: string | null;
  notes: string | null;
  groupId: number | null;
  organizationId: number;
}

/** A new site never takes the default origin; moving it is an explicit choice in the editor. */
export async function insertFacility(f: NewFacility): Promise<number> {
  const now = new Date().toISOString();
  const result = await getDb()
    .prepare(
      `INSERT INTO facilities (id, slug, kind, name, icon_key, address, lat, lng, maps_url, notes, is_default_origin, owner_username, group_id, created_at, updated_at, organization_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)`
    )
    .run(f.restoreId, f.slug, f.kind, f.name, f.iconKey, f.address, f.lat, f.lng, f.mapsUrl, f.notes, f.groupId, now, now, f.organizationId);
  return Number(result.lastInsertRowid);
}

export interface OwnedFacility {
  id: number;
  group_id: number | null;
  kind: string;
  organization_id: number | null;
}

/** One site of this company (null when absent or another tenant's). */
export async function findOwnFacility(id: number, organizationId: number | null): Promise<OwnedFacility | undefined> {
  const own = orgClause("organization_id", organizationId);
  return await getDb()
    .prepare(`SELECT id, group_id, kind, organization_id FROM facilities WHERE id = ?${own.sql}`)
    .get(id, ...own.params) as OwnedFacility | undefined;
}

/** Applies column changes and/or moves the default origin in one transaction, so a failure
 *  between the two cannot leave the company with zero origins (or two). `sets` are fixed
 *  `column = ?` fragments from the route. Throws on a database error. */
export async function updateFacility(
  id: number,
  organizationId: number | null,
  sets: string[],
  values: (string | number | null)[],
  makeDefaultOrigin: boolean
): Promise<void> {
  const db = getDb();
  const own = orgClause("organization_id", organizationId);
  const now = new Date().toISOString();
  await db.tx(async () => {
    if (sets.length > 0) {
      await db.prepare(`UPDATE facilities SET ${[...sets, "updated_at = ?"].join(", ")} WHERE id = ?${own.sql}`).run(...values, now, id, ...own.params);
    }
    if (makeDefaultOrigin) {
      // One default origin per company, so clearing must not reach another company's.
      const row = await db.prepare("SELECT organization_id FROM facilities WHERE id = ?").get(id) as { organization_id: number | null };
      const mine = orgClause("organization_id", row.organization_id);
      await db.prepare(`UPDATE facilities SET is_default_origin = 0, updated_at = ? WHERE is_default_origin = 1${mine.sql}`).run(now, ...mine.params);
      await db.prepare("UPDATE facilities SET is_default_origin = 1, updated_at = ? WHERE id = ?").run(now, id);
    }
  });
}

export type DeleteFacilityResult =
  | { ok: true; deleted: FacilityRow }
  | { ok: false; reason: "not_found" | "last" };

/** Deletes a site of this company. `canReach` is the caller's group rule, applied to the row
 *  before anything changes. The last site is refused; deleting the origin promotes a
 *  replacement from the SAME company (a home base first, then the oldest) in the same transaction. */
export async function deleteFacility(
  id: number,
  organizationId: number | null,
  canReach: (groupId: number | null) => Promise<boolean>
): Promise<DeleteFacilityResult> {
  const db = getDb();
  const owning = await findOwnFacility(id, organizationId);
  const row = await readFacility(db, id);
  if (!row || !owning || !await canReach(owning.group_id)) return { ok: false, reason: "not_found" };

  const org = orgClause("organization_id", organizationId);
  const total = (await db.prepare(`SELECT COUNT(*) c FROM facilities WHERE 1 = 1${org.sql}`).get(...org.params) as { c: number }).c;
  if (total <= 1) return { ok: false, reason: "last" };

  const now = new Date().toISOString();
  const mine = orgClause("organization_id", owning.organization_id);
  await db.tx(async () => {
    await db.prepare("DELETE FROM facilities WHERE id = ?").run(id);
    if (owning.organization_id !== null) await tombstone(owning.organization_id, "facilities", id, db);
    if (row.is_default_origin === 1) {
      await db.prepare(
        `UPDATE facilities SET is_default_origin = 1, updated_at = ?
         WHERE id = (SELECT id FROM facilities WHERE 1 = 1${mine.sql} ORDER BY CASE kind WHEN 'home' THEN 0 ELSE 1 END, id LIMIT 1)`
      ).run(now, ...mine.params);
    }
  });
  return { ok: true, deleted: row };
}
