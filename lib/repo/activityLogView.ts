/** Reads and appends to the activity log. An entry belongs to whatever it is about, so reads join
 *  the entity and apply the caller's `entityGroupFilter("a")`. */

import { getDb, logActivity, type ActivityEntry, type LoggableEntityType } from "@/lib/db";

type Filter = { joins: string; sql: string; params: number[] };

/** Every event of one kind on one date, whichever entity (the day's depot arrivals are read back this way). */
export function activityOnDate(filter: Filter, entityType: string, date: string): ActivityEntry[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM activity_log a${filter.joins}
       WHERE a.entity_type = ? AND a.created_at >= ? AND a.created_at < ?${filter.sql}
       ORDER BY a.created_at`
    )
    .all(entityType, `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`, ...filter.params) as unknown as ActivityEntry[];
}

export function activityForEntity(filter: Filter, entityType: string, entityId: number): ActivityEntry[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM activity_log a${filter.joins}
       WHERE a.entity_type = ? AND a.entity_id = ?${filter.sql}
       ORDER BY a.created_at DESC LIMIT 50`
    )
    .all(entityType, entityId, ...filter.params) as unknown as ActivityEntry[];
}

/** Always a "note": a caller that could pick "status_change" could write history of a change that never happened. */
export function addActivityNote(entityType: LoggableEntityType, entityId: number, note: string, actor: { name: string; id: number }): void {
  logActivity(getDb(), {
    entity_type: entityType,
    entity_id: entityId,
    event_type: "note",
    old_value: null,
    new_value: null,
    note,
    // Both: the name is what the history UI renders, the id is what survives a rename.
    changed_by: actor.name,
    changed_by_user_id: actor.id,
  });
}
