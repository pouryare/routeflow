import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { dueDateFor, parseDays, reminderTitle, serializeDays } from "@/lib/dueReminders";

export async function dueReminderDays(organizationId: number): Promise<number[]> {
  const r = (await getDb().prepare("SELECT due_reminder_days FROM organizations WHERE id = ?").get(organizationId)) as { due_reminder_days: string | null } | undefined;
  return parseDays(r?.due_reminder_days);
}

export async function setDueReminderDays(organizationId: number, days: number[]): Promise<void> {
  await getDb().prepare("UPDATE organizations SET due_reminder_days = ? WHERE id = ?").run(serializeDays(days), organizationId);
}

/** A8: for each chosen day, one call task for the rep of every unpaid order whose due date puts today on that day.
 *  Once per order and day (the title is the key). Run by the rules sweep. */
export async function queueDueReminders(organizationId: number, today = tehranTodayIso()): Promise<number> {
  const days = await dueReminderDays(organizationId);
  const db = getDb();
  let made = 0;
  for (const offset of days) {
    const orders = (await db
      .prepare(
        `SELECT o.id, o.salesperson_user_id, c.business_name, c.group_id FROM orders o JOIN customers c ON c.id = o.customer_id
          WHERE o.organization_id = ? AND o.due_date = ? AND o.payment_status <> 'paid' AND o.status NOT IN ('CANCELLED','RETURNED')`
      )
      .all(organizationId, dueDateFor(today, offset))) as { id: number; salesperson_user_id: number | null; business_name: string; group_id: number | null }[];
    for (const o of orders) {
      const title = reminderTitle(o.business_name, offset);
      const at = new Date().toISOString();
      const res = await db
        .prepare(
          `INSERT INTO tasks (organization_id, assignee_user_id, role_hint, group_id, kind, title, entity_type, entity_id, due_at, priority, status, created_at, created_source)
           SELECT ?, ?, ?, ?, 'call', ?, 'order', ?, ?, 'NORMAL', 'open', ?, 'system'
            WHERE NOT EXISTS (SELECT 1 FROM tasks t WHERE t.organization_id = ? AND t.entity_type = 'order' AND t.entity_id = ? AND t.title = ?)`
        )
        .run(organizationId, o.salesperson_user_id, o.salesperson_user_id ? null : "group_manager", o.group_id, title, o.id, today, at, organizationId, o.id, title);
      made += Number(res.changes);
    }
  }
  return made;
}
