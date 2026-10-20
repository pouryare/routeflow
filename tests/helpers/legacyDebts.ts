import type { DatabaseSync } from "node:sqlite";
import { lineTotalToman, type LineSnapshot } from "@/lib/orderMath";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";

/** The original, row-by-row customerDebtsForOrg, kept verbatim as an oracle. The production
 *  version aggregates in SQL; this one loads every order and every line into JS and does the
 *  arithmetic with the app's own helpers. They must agree on every customer, every bucket. */
export type LegacyDebt = { total: number; bucket_0_7: number; bucket_8_30: number; bucket_30_plus: number };

const ageDays = (nowISO: string, refISO: string) => Math.floor((Date.parse(nowISO) - Date.parse(refISO)) / 86_400_000);
const bucketOf = (debt: LegacyDebt, days: number, amount: number) => {
  if (days < 8) debt.bucket_0_7 += amount;
  else if (days < 31) debt.bucket_8_30 += amount;
  else debt.bucket_30_plus += amount;
};

export function legacyDebtsForOrg(db: DatabaseSync, organizationId: number, asOf?: string): Map<number, LegacyDebt> {
  const now = asOf ?? new Date().toISOString();
  const out = new Map<number, LegacyDebt>();
  const customers = db
    .prepare("SELECT id, COALESCE(opening_balance_toman, 0) AS ob FROM customers WHERE organization_id = ?")
    .all(organizationId) as unknown as { id: number; ob: number }[];
  for (const c of customers) out.set(c.id, { total: c.ob, bucket_0_7: 0, bucket_8_30: 0, bucket_30_plus: c.ob });

  const orders = db
    .prepare(
      `SELECT o.id, o.customer_id, o.order_date, o.delivered_at, o.paid_toman
         FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE c.organization_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`
    )
    .all(organizationId) as unknown as { id: number; customer_id: number; order_date: string; delivered_at: string | null; paid_toman: number }[];
  const lineRows = db
    .prepare(
      `SELECT ol.order_id, ol.packs_ordered, ol.packs_delivered, ol.unit_price_toman,
              ol.unit_cost_toman, ol.qty_per_pack, ol.kg_per_base_unit
         FROM order_lines ol JOIN orders o ON o.id = ol.order_id JOIN customers c ON c.id = o.customer_id
        WHERE c.organization_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`
    )
    .all(organizationId) as unknown as (LineSnapshot & { order_id: number })[];
  const totalByOrder = new Map<number, number>();
  for (const l of lineRows) totalByOrder.set(l.order_id, (totalByOrder.get(l.order_id) ?? 0) + lineTotalToman(l));
  for (const o of orders) {
    const d = out.get(o.customer_id);
    if (!d) continue;
    const total = totalByOrder.get(o.id) ?? 0;
    d.total += total;
    const outstanding = Math.max(0, total - o.paid_toman);
    if (outstanding > 0) bucketOf(d, ageDays(now, o.delivered_at ?? o.order_date), outstanding);
  }
  const allocRows = db
    .prepare(
      `SELECT p.customer_id, COALESCE(SUM(a.amount_toman), 0) AS allocated
         FROM payment_allocations a JOIN payments p ON p.id = a.payment_id
        WHERE p.organization_id = ? AND p.voided_at IS NULL GROUP BY p.customer_id`
    )
    .all(organizationId) as unknown as { customer_id: number; allocated: number }[];
  for (const r of allocRows) {
    const d = out.get(r.customer_id);
    if (d) d.total -= r.allocated;
  }
  return out;
}
