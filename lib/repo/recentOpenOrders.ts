import { getDb } from "@/lib/db";
import { DUPLICATE_WINDOW_HOURS, type OpenOrderBrief } from "@/lib/duplicateOrder";
import { stringAgg } from "@/lib/database/dialect";

/** Statuses where the goods have not left yet: a second copy of one of these is still fixable. */
const OPEN = "'DRAFT', 'PENDING_REVIEW', 'PENDING_CREDIT', 'ON_HOLD', 'CONFIRMED', 'PLANNED', 'READY', 'OUT_FOR_DELIVERY'";

/** F72: the customer's open orders created in the last 24 hours, newest first, with the set of
 *  products on each, for the duplicate-order question. `scope` is the caller's orderFilter
 *  fragment on alias `o`: a person is only warned about orders they could open. */
export async function recentOpenOrders(
  scope: { sql: string; params: number[] },
  customerId: number,
  now = new Date(),
): Promise<OpenOrderBrief[]> {
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_HOURS * 3600_000).toISOString();
  const rows = await getDb()
    .prepare(
      `SELECT o.id, o.order_no, o.created_at, ${stringAgg("ol.product_id", { distinct: true })} AS products
         FROM orders o
         JOIN order_lines ol ON ol.order_id = o.id AND ol.is_reversal = 0
        WHERE o.customer_id = ? AND o.status IN (${OPEN}) AND o.created_at >= ?${scope.sql}
        GROUP BY o.id
        ORDER BY o.created_at DESC, o.id DESC`
    )
    .all(customerId, since, ...scope.params) as unknown as { id: number; order_no: string; created_at: string; products: string }[];
  return rows.map((r) => ({ id: r.id, order_no: r.order_no, created_at: r.created_at, product_ids: r.products.split(",").map(Number) }));
}
