import { getDb } from "@/lib/db";
import { crmFilter, type Session } from "@/lib/session";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, isOneOf } from "@/lib/crm/vocab";

/** F137: what each lead source has produced, from data already stored: how many records came in
 *  from it, how many became customers (have a delivered order), and what those customers bought in
 *  the 90 days from their first delivered order. Spend per source is not recorded yet, so there is
 *  no return on spend; this is the half that needs no new data.
 *
 *  Counts every record the person can see in the CRM (crmFilter), all time: the records carry no
 *  creation date of their own to window by. Merged records are left out. A record with no source
 *  is its own row, so the table does not look more complete than the data is. */

export const REVENUE_WINDOW_DAYS = 90;

export interface SourceRow {
  source: string | null;
  label: string;
  leads: number;
  converted: number;
  /** converted / leads, 0..1. */
  rate: number;
  revenue90: number;
}

export function leadSourceReport(session: Session): SourceRow[] {
  const f = crmFilter(session, "c");
  const fulfilled = sqlStatusList(FULFILLED_ORDER_STATUSES);
  const rows = getDb()
    .prepare(
      `WITH firsts AS (
         SELECT o.customer_id, MIN(o.order_date) AS first_day
           FROM orders o JOIN customers c ON c.id = o.customer_id
          WHERE o.status IN (${fulfilled})${f.sql}
          GROUP BY o.customer_id
       ),
       early AS (
         SELECT o.customer_id,
                SUM((SELECT COALESCE(SUM(ROUND(COALESCE(l.packs_delivered, l.packs_ordered) * l.unit_price_toman)), 0)
                       FROM order_lines l WHERE l.order_id = o.id)) AS revenue
           FROM orders o JOIN firsts fr ON fr.customer_id = o.customer_id
          WHERE o.status IN (${fulfilled}) AND o.order_date <= date(fr.first_day, '+${REVENUE_WINDOW_DAYS} days')
          GROUP BY o.customer_id
       )
       SELECT c.source_code AS source, COUNT(*) AS leads,
              SUM(CASE WHEN fr.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS converted,
              COALESCE(SUM(e.revenue), 0) AS revenue90
         FROM customers c
         LEFT JOIN firsts fr ON fr.customer_id = c.id
         LEFT JOIN early e ON e.customer_id = c.id
        WHERE c.merged_into_id IS NULL${f.sql}
        GROUP BY c.source_code`
    )
    .all(...f.params, ...f.params) as unknown as { source: string | null; leads: number; converted: number; revenue90: number }[];
  return rows
    .map((r) => ({
      source: r.source,
      label: isOneOf(LEAD_SOURCES, r.source) ? LEAD_SOURCE_LABEL[r.source] : r.source ? "سایر" : "بدون منبع",
      leads: r.leads,
      converted: r.converted,
      rate: r.leads ? r.converted / r.leads : 0,
      revenue90: r.revenue90,
    }))
    .sort((a, b) => b.revenue90 - a.revenue90 || b.leads - a.leads);
}
