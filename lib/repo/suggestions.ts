import { getDb } from "@/lib/db";
import type { Session } from "@/lib/session";
import { tehranTodayIso } from "@/lib/jalali";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { buildSuggestions, typicalGap, type ChurnSignal, type ReorderSignal, type Suggestion } from "@/lib/briefingSuggestions";

/** The suggestions for a phone salesperson: their OWN customers (the ones they have sold to),
 *  at risk of leaving or due to order again. Other roles get none: the call and the order are
 *  personal actions, and a manager's list of someone else's customers is the churn board's job. */
export function suggestionsFor(session: Session): Suggestion[] {
  if (session.role !== "phone_sales") return [];
  const db = getDb();
  const org = session.organizationId;
  const user = session.user.id;
  const today = tehranTodayIso();
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  const churn = db
    .prepare(
      `SELECT c.id AS customerId, c.business_name AS name, c.phone, cs.probability, cs.reason_fa AS reason
         FROM churn_scores cs JOIN customers c ON c.id = cs.customer_id
        WHERE cs.organization_id = ? AND cs.band = 'high'
          AND c.id IN (SELECT customer_id FROM orders WHERE organization_id = ? AND salesperson_user_id = ?)
        ORDER BY cs.probability DESC LIMIT 5`
    )
    .all(org, org, user) as unknown as ChurnSignal[];

  const rows = db
    .prepare(
      `SELECT c.id AS customerId, c.business_name AS name, c.phone, o.order_date AS day
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE o.organization_id = ? AND o.salesperson_user_id = ?
          AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})
        ORDER BY c.id, o.order_date`
    )
    .all(org, user) as unknown as { customerId: number; name: string; phone: string | null; day: string }[];

  const byCustomer = new Map<number, { name: string; phone: string | null; days: string[] }>();
  for (const r of rows) {
    const e = byCustomer.get(r.customerId) ?? { name: r.name, phone: r.phone, days: [] };
    e.days.push(r.day.slice(0, 10));
    byCustomer.set(r.customerId, e);
  }
  const reorder: ReorderSignal[] = [];
  for (const [customerId, e] of byCustomer) {
    const gap = typicalGap(e.days);
    if (gap === null) continue;
    const last = e.days[e.days.length - 1];
    reorder.push({
      customerId,
      name: e.name,
      phone: e.phone,
      daysSinceLast: Math.round((todayMs - Date.parse(`${last}T00:00:00Z`)) / 86_400_000),
      typicalGapDays: gap,
    });
  }
  return buildSuggestions({ churn, reorder });
}
