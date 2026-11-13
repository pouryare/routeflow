import { getDb } from "@/lib/db";

/** FB24: tell the driver(s) whose run still has a pending stop for this order. One notification per driver and change;
 *  the rules sweep (or the next flush) sends the push. */
export async function noticeOrderChange(organizationId: number, orderId: number, line: string): Promise<number> {
  const db = getDb();
  const drivers = (await db
    .prepare(
      `SELECT DISTINCT r.driver_user_id AS id, c.business_name AS customer
         FROM delivery_stops s JOIN delivery_runs r ON r.id = s.run_id JOIN orders o ON o.id = s.order_id JOIN customers c ON c.id = o.customer_id
        WHERE s.order_id = ? AND o.organization_id = ? AND s.status = 'pending' AND r.status <> 'done'`
    )
    .all(orderId, organizationId)) as { id: number; customer: string }[];
  const now = new Date().toISOString();
  for (const d of drivers) {
    await db
      .prepare("INSERT INTO notifications (organization_id, user_id, type_code, title_fa, body_fa, group_key, priority, created_at) VALUES (?, ?, 'order.changed', ?, ?, ?, 'HIGH', ?)")
      .run(organizationId, d.id, `سفارش ${d.customer} تغییر کرد`, line, `order.changed:${orderId}:${now}`, now);
  }
  return drivers.length;
}
