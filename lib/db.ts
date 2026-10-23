import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { instrumentSlowSql, slowSqlThresholdMs } from "./slowSql";
import { createBaseSchema } from "./database/schema";
import { runMigrations } from "./database/migrate";

// Re-exported so server modules that already import from db.ts keep one import site. The code
// itself lives in lib/database/: types, seeds, backfills, rebuilds, the base schema and the
// ordered migrations (see ./database/migrate.ts).
import type { ActivityEntry, LeadListRow, LeadListWithItems } from "./database/types";
export * from "./database/types";
export * from "./database/seeds";
export * from "./database/backfills";
export { TENANT_TABLES } from "./database/tenantTables";
export type { FacilityKind, FacilityRow } from "./facilityTypes";
export { FACILITY_KINDS, FACILITY_ICONS, defaultIconFor } from "./facilityTypes";

export const DB_PATH = process.env.ROUTEFLOW_DB_PATH || path.join(process.cwd(), "data", "routeflow.db");

let _db: DatabaseSync | null = null;

/** Rows from node:sqlite, made safe to hand to a client component.
 *
 *  `DatabaseSync.prepare().all()` returns objects with a **null prototype**. React
 *  refuses to serialise those across the server/client boundary -- "Only plain objects,
 *  and a few built-ins, can be passed to Client Components" -- and the page 500s at
 *  render time. Nothing in the types sees it: a null-prototype object satisfies every
 *  interface it structurally matches, so tsc, eslint and every unit test pass while the
 *  page is broken. It only shows up in a browser.
 *
 *  So any query result that crosses into a `"use client"` component goes through here
 *  first. Results that only ever render on the server do not need it.
 */
export function plain<T>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }));
}

export function getDb(): DatabaseSync {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // Opt-in: ROUTEFLOW_SLOW_SQL_MS=200 logs any statement that takes that long, migrations included.
  const slowMs = slowSqlThresholdMs();
  if (slowMs > 0) instrumentSlowSql(db, slowMs);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  /* Read tuning. synchronous is deliberately left at FULL: the offline outbox drops a fact
     once the server acknowledges it, so a commit lost after an ack would never be re-sent.
     cache_size is negative = KiB, so -65536 is 64 MiB. mmap_size lets large reads skip a
     copy. busy_timeout makes a second writer wait rather than throw SQLITE_BUSY -- the
     lead-import runner and the request path share this file. */
  db.exec("PRAGMA temp_store = MEMORY;");
  db.exec("PRAGMA cache_size = -65536;");
  db.exec("PRAGMA mmap_size = 268435456;");
  db.exec("PRAGMA busy_timeout = 5000;");

  createBaseSchema(db);
  runMigrations(db);

  _db = db;
  return db;
}


export function readLeadLists(
  db: DatabaseSync = getDb(),
  groupIds: number[] | "all" = "all"
): LeadListWithItems[] {
  // See readCustomers: an empty scope must read as "nothing", never as "everything".
  if (groupIds !== "all" && groupIds.length === 0) return [];
  const where = groupIds === "all" ? "" : ` WHERE group_id IN (${groupIds.map(() => "?").join(", ")})`;
  const params = groupIds === "all" ? [] : groupIds;
  const lists = db
    .prepare(`SELECT id, name, created_at, updated_at FROM lead_lists${where} ORDER BY created_at`)
    .all(...params) as unknown as LeadListRow[];

  const items = db
    .prepare("SELECT list_id, location_id FROM lead_list_items ORDER BY list_id, sort_order, id")
    .all() as unknown as { list_id: number; location_id: number }[];

  const byList = new Map<number, number[]>();
  for (const it of items) {
    const arr = byList.get(it.list_id);
    if (arr) arr.push(it.location_id);
    else byList.set(it.list_id, [it.location_id]);
  }

  // Rebuilt as object literals rather than passed through: node:sqlite hands back
  // null-prototype rows, which cannot cross into a Client Component.
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
export function setLeadListItems(db: DatabaseSync, listId: number, locationIds: number[]): void {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM lead_list_items WHERE list_id = ?").run(listId);
    const insert = db.prepare(
      "INSERT INTO lead_list_items (list_id, location_id, sort_order, created_at) VALUES (?, ?, ?, ?)"
    );
    locationIds.forEach((locationId, i) => insert.run(listId, locationId, i, now));
    db.prepare("UPDATE lead_lists SET updated_at = ? WHERE id = ?").run(now, listId);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function logActivity(
  db: DatabaseSync,
  entry: Omit<ActivityEntry, "id" | "created_at" | "changed_by_user_id"> & {
    changed_by_user_id?: number | null;
    /** Who was really driving, when this happened under Login-As. */
    impersonated_by?: number | null;
  }
): void {
  db.prepare(
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
