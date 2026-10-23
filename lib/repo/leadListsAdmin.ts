/** Saved lead lists (ordered sets of saved pins). A list belongs to one company and, within it,
 *  to one group; every lookup names the company so a list id from another tenant is "not found"
 *  even when the list has no group (which an owner would otherwise reach). */

import { getDb, setLeadListItems } from "@/lib/db";
import { orgClause } from "@/lib/orgScope";

/** Saved pins the caller may put on a list: this company's, within `groupSql`'s group scope. */
async function usableLocationIds(ids: number[], organizationId: number | null, groupSql: { sql: string; params: (string | number)[] }): Promise<number[]> {
  const org = orgClause("organization_id", organizationId);
  const known = new Set(
    (
      await getDb()
        .prepare(`SELECT id FROM saved_locations WHERE 1 = 1${groupSql.sql}${org.sql}`)
        .all(...groupSql.params, ...org.params) as unknown as { id: number }[]
    ).map((r) => r.id)
  );
  return ids.filter((id) => known.has(id));
}

export async function createLeadList(
  name: string,
  groupId: number | null,
  organizationId: number,
  locationIds: number[],
  groupSql: { sql: string; params: (string | number)[] }
): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const result = await db
    .prepare("INSERT INTO lead_lists (name, group_id, created_at, updated_at, organization_id) VALUES (?, ?, ?, ?, ?)")
    .run(name, groupId, now, now, organizationId);
  const id = Number(result.lastInsertRowid);
  // Filtered like a replace: pins of another group or company cannot be pulled onto a list and read back.
  const usable = await usableLocationIds(locationIds, organizationId, groupSql);
  if (usable.length) await setLeadListItems(db, id, usable);
  return id;
}

export interface OwnList {
  id: number;
  name: string;
  group_id: number | null;
}

export async function findOwnList(id: number, organizationId: number | null): Promise<OwnList | undefined> {
  const org = orgClause("organization_id", organizationId);
  return await getDb().prepare(`SELECT id, name, group_id FROM lead_lists WHERE id = ?${org.sql}`).get(id, ...org.params) as OwnList | undefined;
}

export async function renameLeadList(id: number, organizationId: number | null, name: string): Promise<void> {
  const org = orgClause("organization_id", organizationId);
  await getDb().prepare(`UPDATE lead_lists SET name = ?, updated_at = ? WHERE id = ?${org.sql}`).run(name, new Date().toISOString(), id, ...org.params);
}

/** Replaces the membership with exactly `ids`, minus pins that no longer exist or are out of scope
 *  (a dead entry would violate the foreign key and roll back the whole reorder). */
export async function replaceLeadListItems(
  id: number,
  organizationId: number | null,
  ids: number[],
  groupSql: { sql: string; params: (string | number)[] }
): Promise<void> {
  await setLeadListItems(getDb(), id, await usableLocationIds(ids, organizationId, groupSql));
}

/** Deletes the list and returns its membership so the delete can be undone from the toast. */
export async function deleteLeadList(id: number, organizationId: number | null): Promise<number[]> {
  const db = getDb();
  const org = orgClause("organization_id", organizationId);
  const items = await db
    .prepare("SELECT location_id FROM lead_list_items WHERE list_id = ? ORDER BY sort_order, id")
    .all(id) as unknown as { location_id: number }[];
  await db.prepare(`DELETE FROM lead_lists WHERE id = ?${org.sql}`).run(id, ...org.params);
  return items.map((i) => i.location_id);
}
