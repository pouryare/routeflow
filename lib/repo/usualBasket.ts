import { getDb } from "@/lib/db";
import { usualBasket, USUAL_WINDOW, type BasketLine } from "@/lib/flows/orderQuick";

/** F58: the lines this customer orders most of the time, from their last five repeatable orders
 *  (not drafts, cancelled or returned ones, as `pickLastOrder`). `scope` is the caller's
 *  orderFilter fragment on alias `o`, so a salesperson builds it from their own orders only, the
 *  same orders the list beside it shows. */
export async function customerUsualBasket(scope: { sql: string; params: number[] }, customerId: number): Promise<BasketLine[]> {
  const db = getDb();
  const orders = await db
    .prepare(
      `SELECT o.id FROM orders o
        WHERE o.customer_id = ? AND o.status NOT IN ('DRAFT', 'CANCELLED', 'RETURNED')${scope.sql}
        ORDER BY o.order_date DESC, o.id DESC
        LIMIT ${USUAL_WINDOW}`
    )
    .all(customerId, ...scope.params) as unknown as { id: number }[];
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const lines = await db
    .prepare(
      `SELECT ol.order_id, ol.product_id, ol.packaging_id, ol.packs_ordered
         FROM order_lines ol
        WHERE ol.is_reversal = 0 AND ol.order_id IN (${ids.map(() => "?").join(",")})`
    )
    .all(...ids) as unknown as (BasketLine & { order_id: number })[];
  return usualBasket(ids.map((id) => lines.filter((l) => l.order_id === id)));
}
