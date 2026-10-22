/** Reminders about a customer or district. A reminder row carries no company of its own; it is
 *  scoped through the entity it is about (`entityGroupFilter`, `canReachEntity`), applied by the
 *  caller before anything here runs. */

import { getDb, type Reminder } from "@/lib/db";
import { withEntityLabels } from "@/lib/repo/entityLabels";

type Filter = { joins: string; sql: string; params: number[] };

/** `dueBy` null lists every reminder (resolved ones last); otherwise unresolved ones due on or before it. */
export function listReminders(filter: Filter, dueBy: string | null) {
  const db = getDb();
  const rows = (
    dueBy
      ? db
          .prepare(`SELECT r.* FROM reminders r${filter.joins} WHERE r.resolved = 0 AND r.due_date <= ?${filter.sql} ORDER BY r.due_date`)
          .all(dueBy, ...filter.params)
      : db
          .prepare(`SELECT r.* FROM reminders r${filter.joins} WHERE 1 = 1${filter.sql} ORDER BY r.resolved, r.due_date`)
          .all(...filter.params)
  ) as unknown as Reminder[];
  return withEntityLabels(db, rows);
}

export function addReminder(entityType: string, entityId: number, dueDate: string, message: string): number {
  const result = getDb()
    .prepare(`INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
    .run(entityType, entityId, dueDate, message, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function reminderEntity(id: number): { entity_type: string; entity_id: number } | undefined {
  return getDb().prepare("SELECT entity_type, entity_id FROM reminders WHERE id = ?").get(id) as
    | { entity_type: string; entity_id: number }
    | undefined;
}

export function setReminderResolved(id: number, resolved: boolean): boolean {
  return getDb().prepare("UPDATE reminders SET resolved = ? WHERE id = ?").run(resolved ? 1 : 0, id).changes > 0;
}

export function deleteReminder(id: number): void {
  getDb().prepare("DELETE FROM reminders WHERE id = ?").run(id);
}
