import { getDb } from "@/lib/db";
import { tehranTodayIso } from "@/lib/jalali";
import { groupFilter, type Session } from "@/lib/session";

/** F50: a customer's promise to pay. Kept = payments since it was noted reach its amount; broken = the
 *  date passed and they do not. Both are worked out when read, so a payment needs no hook. */
export type PromiseStatus = "open" | "kept" | "broken" | "cancelled";

export interface PromiseRow {
  id: number;
  customer_id: number;
  amount_toman: number;
  promised_date: string;
  created_at: string;
  created_by_name: string | null;
  status: PromiseStatus;
}

const SELECT = `SELECT p.id, p.customer_id, p.amount_toman, p.promised_date, p.created_at, p.cancelled_at, u.display_name AS created_by_name,
       COALESCE((SELECT SUM(pm.amount_toman) FROM payments pm WHERE pm.organization_id = p.organization_id AND pm.customer_id = p.customer_id
                  AND pm.voided_at IS NULL AND pm.received_at >= p.created_at), 0) AS paid_since
  FROM payment_promises p JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.created_by`;

type Raw = Omit<PromiseRow, "status"> & { cancelled_at: string | null; paid_since: number };

export function promiseStatus(r: { cancelled_at: string | null; paid_since: number; amount_toman: number; promised_date: string }, today: string): PromiseStatus {
  if (r.cancelled_at) return "cancelled";
  if (Number(r.paid_since) >= Number(r.amount_toman)) return "kept";
  return r.promised_date < today ? "broken" : "open";
}

const shape = (r: Raw, today: string): PromiseRow => ({
  id: Number(r.id), customer_id: Number(r.customer_id), amount_toman: Number(r.amount_toman), promised_date: r.promised_date,
  created_at: r.created_at, created_by_name: r.created_by_name, status: promiseStatus(r, today),
});

/** The reason it is refused, or null once saved. */
export async function createPromise(orgId: number, customerId: number, amount: unknown, date: unknown, by: number): Promise<string | null> {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return "مبلغ وعده نامعتبر است";
  const today = tehranTodayIso();
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today) return "تاریخ وعده باید امروز یا بعد از آن باشد";
  const db = getDb();
  if (!(await db.prepare("SELECT 1 FROM customers WHERE id = ? AND organization_id = ?").get(customerId, orgId))) return "مشتری پیدا نشد";
  await db
    .prepare("INSERT INTO payment_promises (organization_id, customer_id, amount_toman, promised_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(orgId, customerId, amount, date, by, new Date().toISOString());
  return null;
}

export async function cancelPromise(orgId: number, customerId: number, id: number): Promise<boolean> {
  const r = await getDb()
    .prepare("UPDATE payment_promises SET cancelled_at = ? WHERE id = ? AND customer_id = ? AND organization_id = ? AND cancelled_at IS NULL")
    .run(new Date().toISOString(), id, customerId, orgId);
  return Number(r.changes ?? 0) > 0;
}

/** The latest promises of one customer, newest first. */
export async function promisesOf(orgId: number, customerId: number): Promise<PromiseRow[]> {
  const today = tehranTodayIso();
  const rows = (await getDb().prepare(`${SELECT} WHERE p.organization_id = ? AND p.customer_id = ? ORDER BY p.id DESC LIMIT 20`).all(orgId, customerId)) as unknown as Raw[];
  return rows.map((r) => shape(r, today));
}

/** Promises of this person's customers that passed their date unpaid in the last 30 days, for the action centre. */
export async function brokenPromisesFor(session: Session): Promise<(PromiseRow & { customer_name: string })[]> {
  const today = tehranTodayIso();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
  const scope = await groupFilter(session, "c.group_id");
  const rows = (await getDb()
    .prepare(`${SELECT.replace("u.display_name AS created_by_name,", "u.display_name AS created_by_name, c.business_name AS customer_name,")}
       WHERE p.organization_id = ? AND p.cancelled_at IS NULL AND p.promised_date < ? AND p.promised_date >= ?${scope.sql} ORDER BY p.promised_date DESC LIMIT 30`)
    .all(session.organizationId, today, since, ...scope.params)) as unknown as (Raw & { customer_name: string })[];
  return rows.map((r) => ({ ...shape(r, today), customer_name: r.customer_name })).filter((r) => r.status === "broken");
}
