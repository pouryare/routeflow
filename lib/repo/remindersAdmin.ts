/** Reminders about a customer or district. A reminder row carries no company of its own; it is
 *  scoped through the entity it is about (`entityGroupFilter`, `canReachEntity`), applied by the
 *  caller before anything here runs. */

import { getDb, type Reminder } from "@/lib/db";
import { withEntityLabels } from "@/lib/repo/entityLabels";

type Filter = { joins: string; sql: string; params: number[] };

/** `dueBy` null lists every reminder (resolved ones last); otherwise unresolved ones due on or before it. */
export async function listReminders(filter: Filter, dueBy: string | null) {
  const db = getDb();
  const rows = (
    dueBy
      ? await db
          .prepare(`SELECT r.* FROM reminders r${filter.joins} WHERE r.resolved = 0 AND r.due_date <= ?${filter.sql} ORDER BY r.due_date`)
          .all(dueBy, ...filter.params)
      : await db
          .prepare(`SELECT r.* FROM reminders r${filter.joins} WHERE 1 = 1${filter.sql} ORDER BY r.resolved, r.due_date`)
          .all(...filter.params)
  ) as unknown as Reminder[];
  return await withEntityLabels(db, rows);
}

export async function addReminder(entityType: string, entityId: number, dueDate: string, message: string): Promise<number> {
  const result = await getDb()
    .prepare(`INSERT INTO reminders (entity_type, entity_id, due_date, message, resolved, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
    .run(entityType, entityId, dueDate, message, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export async function reminderEntity(id: number): Promise<{ entity_type: string; entity_id: number } | undefined> {
  return await getDb().prepare("SELECT entity_type, entity_id FROM reminders WHERE id = ?").get(id) as
    | { entity_type: string; entity_id: number }
    | undefined;
}

export async function setReminderResolved(id: number, resolved: boolean): Promise<boolean> {
  return (await getDb().prepare("UPDATE reminders SET resolved = ? WHERE id = ?").run(resolved ? 1 : 0, id)).changes > 0;
}

export async function deleteReminder(id: number): Promise<void> {
  await getDb().prepare("DELETE FROM reminders WHERE id = ?").run(id);
}
