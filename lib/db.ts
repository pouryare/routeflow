import type { Db } from "./database/client";
import { getDb } from "./database/connection";

// Re-exported so server modules that already import from db.ts keep one import site. The code
// itself lives in lib/database/: the connection, the Db interface, the types.
import type { ActivityEntry, LeadListRow, LeadListWithItems } from "./database/types";
export * from "./database/types";
export type { Db, Statement, Row } from "./database/client";
export { DB_PATH, getDb, dbReady } from "./database/connection";
export { TENANT_TABLES } from "./database/tenantTables";
export type { FacilityKind, FacilityRow } from "./facilityTypes";
export { FACILITY_KINDS, FACILITY_ICONS, defaultIconFor } from "./facilityTypes";

/** Rows copied into plain objects, for a result that crosses into a `"use client"` component.
 *
 *  The pg driver already returns plain objects; this stays because React refuses anything else
 *  across the server/client boundary ("Only plain objects, and a few built-ins, can be passed to
 *  Client Components") and the page 500s at render time, which no type or unit test sees.
 */
export function plain<T>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

export async function readLeadLists(
  db: Db = getDb(),
  groupIds: number[] | "all" = "all"
): Promise<LeadListWithItems[]> {
  // See readCustomers: an empty scope must read as "nothing", never as "everything".
  if (groupIds !== "all" && groupIds.length === 0) return [];
  const where = groupIds === "all" ? "" : ` WHERE group_id IN (${groupIds.map(() => "?").join(", ")})`;
  const params = groupIds === "all" ? [] : groupIds;
  const lists = await db
    .prepare(`SELECT id, name, created_at, updated_at FROM lead_lists${where} ORDER BY created_at`)
    .all(...params) as unknown as LeadListRow[];

  const items = await db
    .prepare("SELECT list_id, location_id FROM lead_list_items ORDER BY list_id, sort_order, id")
    .all() as unknown as { list_id: number; location_id: number }[];

  const byList = new Map<number, number[]>();
  for (const it of items) {
    const arr = byList.get(it.list_id);
    if (arr) arr.push(it.location_id);
    else byList.set(it.list_id, [it.location_id]);
  }

  // Rebuilt as object literals rather than passed through.
  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    created_at: l.created_at,
    updated_at: l.updated_at,
    location_ids: byList.get(l.id) ?? [],
  }));
}

/** Replaces a list's membership wholesale.
 *
 *  A whole-list write rather than add/remove/reorder endpoints: the order is the point,
 *  every edit changes it, and three endpoints that each have to renumber the others is
 *  three chances to leave the list inconsistent. One statement, one transaction, one
 *  possible outcome.
 */
export async function setLeadListItems(db: Db, listId: number, locationIds: number[]): Promise<void> {
  const now = new Date().toISOString();
  await db.tx(async () => {
    await db.prepare("DELETE FROM lead_list_items WHERE list_id = ?").run(listId);
    const insert = db.prepare(
      "INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (?, ?, ?, ?)"
    );
    for (const [i, locationId] of locationIds.entries()) await insert.run(listId, locationId, i, now);
    await db.prepare("UPDATE lead_lists SET updated_at = ? WHERE id = ?").run(now, listId);
  });
}

export async function logActivity(
  db: Db,
  entry: Omit<ActivityEntry, "id" | "created_at" | "changed_by_user_id"> & {
    changed_by_user_id?: number | null;
    /** Who was really driving, when this happened under Login-As. */
    impersonated_by?: number | null;
  }
): Promise<void> {
  await db.prepare(
    `INSERT INTO activity_log (entity_type, entity_id, event_type, old_value, new_value, note, changed_by, changed_by_user_id, impersonated_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.entity_type,
    entry.entity_id,
    entry.event_type,
    entry.old_value,
    entry.new_value,
    entry.note,
    entry.changed_by,
    entry.changed_by_user_id ?? null,
    entry.impersonated_by ?? null,
    new Date().toISOString()
  );
}
