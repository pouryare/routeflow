import { getDb } from "@/lib/db";
import { addDaysIso } from "@/lib/flows/dates";
import { tehranTodayIso } from "@/lib/jalali";

/** F74: the loose ends of one salesperson's day, all from data that is already there. */
export interface WrapUp {
  drafts: { id: number; order_no: string; customer_name: string }[];
  overdueTasks: { id: number; title: string; entity_type: string | null; entity_id: number | null }[];
  promisesDue: { customer_id: number; customer_name: string; amount_toman: number }[];
  tomorrow: { id: number; title: string }[];
  closed: boolean;
}

export const wrapUpEmpty = (w: WrapUp): boolean => w.drafts.length + w.overdueTasks.length + w.promisesDue.length + w.tomorrow.length === 0;

export async function wrapUpFor(orgId: number, userId: number, today = tehranTodayIso()): Promise<WrapUp> {
  const db = getDb();
  const tomorrow = addDaysIso(today, 1);
  const drafts = (await db
    .prepare(
      `SELECT o.id, o.order_no, c.business_name AS customer_name FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.organization_id = ? AND o.status = 'DRAFT' AND (o.salesperson_user_id = ? OR (o.salesperson_user_id IS NULL AND o.created_by = ?)) ORDER BY o.id DESC LIMIT 10`,
    )
    .all(orgId, userId, userId)) as WrapUp["drafts"];
  const overdueTasks = (await db
    .prepare(
      `SELECT id, title, entity_type, entity_id FROM tasks
        WHERE organization_id = ? AND assignee_user_id = ? AND status = 'open' AND due_at IS NOT NULL AND substr(due_at, 1, 10) <= ? ORDER BY due_at LIMIT 10`,
    )
    .all(orgId, userId, today)) as WrapUp["overdueTasks"];
  const promisesDue = (await db
    .prepare(
      `SELECT p.customer_id, c.business_name AS customer_name, p.amount_toman FROM payment_promises p JOIN customers c ON c.id = p.customer_id
        WHERE p.organization_id = ? AND p.created_by = ? AND p.cancelled_at IS NULL AND p.promised_date <= ?
          AND COALESCE((SELECT SUM(pm.amount_toman) FROM payments pm WHERE pm.organization_id = p.organization_id AND pm.customer_id = p.customer_id
                         AND pm.voided_at IS NULL AND pm.received_at >= p.created_at), 0) < p.amount_toman
          AND p.promised_date >= ? ORDER BY p.promised_date LIMIT 10`,
    )
    .all(orgId, userId, today, today)) as WrapUp["promisesDue"];
  const next = (await db
    .prepare(
      `SELECT id, title FROM tasks WHERE organization_id = ? AND assignee_user_id = ? AND status = 'open' AND due_at IS NOT NULL
          AND substr(due_at, 1, 10) = ? ORDER BY due_at LIMIT 3`,
    )
    .all(orgId, userId, tomorrow)) as WrapUp["tomorrow"];
  const closed = !!(await db.prepare("SELECT 1 FROM day_wrapups WHERE organization_id = ? AND user_id = ? AND day = ?").get(orgId, userId, today));
  const n = <T extends { id?: number | string; customer_id?: number | string; amount_toman?: number | string }>(r: T) => ({ ...r, ...(r.id !== undefined ? { id: Number(r.id) } : {}), ...(r.customer_id !== undefined ? { customer_id: Number(r.customer_id) } : {}), ...(r.amount_toman !== undefined ? { amount_toman: Number(r.amount_toman) } : {}) });
  return {
    drafts: drafts.map(n),
    overdueTasks: overdueTasks.map((t) => ({ ...n(t), entity_id: t.entity_id === null ? null : Number(t.entity_id) })),
    promisesDue: promisesDue.map(n),
    tomorrow: next.map(n),
    closed,
  };
}

/** Marks today closed; saying it twice changes nothing. */
export async function closeDay(orgId: number, userId: number, today = tehranTodayIso()): Promise<void> {
  await getDb()
    .prepare("INSERT INTO day_wrapups (organization_id, user_id, day, closed_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
    .run(orgId, userId, today, new Date().toISOString());
}
