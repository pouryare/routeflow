import type { Db } from "@/lib/database/client";
import { releaseForOrder, reserveForOrder } from "@/lib/repo/stock";

/** Goods on open purchase orders that no pre-order has claimed yet, for one product (F121). First come, first served: an order may promise only what is left. */
export async function unpromisedIncoming(db: Db, orgId: number, productId: number): Promise<number> {
  const r = (await db
    .prepare(
      `SELECT COALESCE((SELECT SUM(l.base_qty - LEAST(l.received_qty, l.base_qty)) FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
                         WHERE po.organization_id = ? AND l.product_id = ? AND po.status IN ('ordered', 'partly_received')), 0)
            - COALESCE((SELECT SUM(ol.packs_ordered * ol.qty_per_pack) FROM order_lines ol JOIN orders o ON o.id = ol.order_id
                         WHERE o.organization_id = ? AND ol.product_id = ? AND ol.is_preorder = 1 AND o.status NOT IN ('CANCELLED', 'CLOSED', 'RETURNED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'DELIVERY_FAILED')), 0) AS left`
    )
    .get(orgId, productId, orgId, productId)) as { left: number };
  return Math.max(0, Number(r.left));
}

/** After goods arrive: the open orders that were promised some of them (oldest first) take their share. An order that already holds a reservation gets it re-made, and a pre-order line that is now fully covered becomes an ordinary line. */
export async function fillPreorders(db: Db, orgId: number, productIds: number[]): Promise<void> {
  if (productIds.length === 0) return;
  const mark = productIds.map(() => "?").join(",");
  const orders = (await db
    .prepare(
      `SELECT DISTINCT o.id FROM orders o JOIN order_lines ol ON ol.order_id = o.id
        WHERE o.organization_id = ? AND ol.is_preorder = 1 AND ol.product_id IN (${mark})
          AND EXISTS (SELECT 1 FROM stock_reservations r WHERE r.order_id = o.id AND r.released_at IS NULL)
        ORDER BY o.id`
    )
    .all(orgId, ...productIds)) as unknown as { id: number }[];
  for (const o of orders) {
    await releaseForOrder(orgId, Number(o.id), db);
    await reserveForOrder(orgId, Number(o.id), db);
    await db
      .prepare(
        `UPDATE order_lines SET is_preorder = 0
          WHERE order_id = ? AND is_preorder = 1
            AND NOT EXISTS (SELECT 1 FROM stock_reservations r WHERE r.order_line_id = order_lines.id AND r.released_at IS NULL AND r.batch_id IS NULL)`
      )
      .run(Number(o.id));
  }
}
