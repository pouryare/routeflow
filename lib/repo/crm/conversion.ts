import type { DatabaseSync } from "node:sqlite";
import { recomputeState } from "./state";

/** A delivered sale converts the same business row, inside the order transaction. */
export function convertOnDelivery(conn: DatabaseSync, orgId: number, orderId: number, actorId: number | null): void {
  const o = conn.prepare("SELECT customer_id, COALESCE(order_type, 'SALE') AS order_type FROM orders WHERE id = ? AND organization_id = ?")
    .get(orderId, orgId) as { customer_id: number; order_type: string } | undefined;
  if (!o || o.order_type !== "SALE") return;
  const n = (conn.prepare(`SELECT COUNT(*) n FROM orders WHERE customer_id = ? AND organization_id = ? AND COALESCE(order_type, 'SALE') = 'SALE'
                            AND status IN ('DELIVERED', 'PARTIALLY_DELIVERED', 'CLOSED')`).get(o.customer_id, orgId) as { n: number }).n;
  const at = new Date().toISOString();
  conn.prepare(`INSERT INTO activities (organization_id, customer_id, user_id, type, note, stage_to, verification_to, occurred_at, created_at)
                VALUES (?, ?, ?, 'order', ?, ?, 'verified', ?, ?)`)
    .run(orgId, o.customer_id, actorId, `سفارش ${orderId} تحویل شد`, n >= 2 ? "repeat_customer" : "first_order", at, at);
  conn.prepare("UPDATE customers SET first_order_at = COALESCE(first_order_at, ?) WHERE id = ? AND organization_id = ?").run(at, o.customer_id, orgId);
  recomputeState(conn, o.customer_id);
}
