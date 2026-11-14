import { getDb } from "@/lib/db";
import { deliveryCode, codeResult } from "@/lib/deliveryCode";

const secret = () => process.env.SESSION_SECRET ?? "";

/** The code for an order, or null when its customer does not ask for one (so the page shows nothing). */
export async function codeForOrder(orgId: number, orderId: number): Promise<string | null> {
  const r = (await getDb().prepare("SELECT c.delivery_code_required AS req FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ? AND o.organization_id = ?").get(orderId, orgId)) as { req: boolean } | undefined;
  return r?.req ? deliveryCode(orderId, secret()) : null;
}

/** After the driver records a stop: keep whether the typed code matched. Never refuses the delivery. */
export async function recordCodeResult(orgId: number, stopId: number, given: string | null): Promise<void> {
  const db = getDb();
  const s = (await db.prepare("SELECT ds.order_id FROM delivery_stops ds JOIN orders o ON o.id = ds.order_id WHERE ds.id = ? AND o.organization_id = ?").get(stopId, orgId)) as { order_id: number } | undefined;
  if (!s) return;
  const expected = await codeForOrder(orgId, s.order_id);
  if (expected === null) return;
  await db.prepare("UPDATE deliveries SET code_ok = ? WHERE route_stop_id = ? AND organization_id = ?").run(codeResult(expected, given), stopId, orgId);
}

export async function setCodeRequired(orgId: number, customerId: number, on: boolean): Promise<string | null> {
  const r = await getDb().prepare("UPDATE customers SET delivery_code_required = ? WHERE id = ? AND organization_id = ?").run(on, customerId, orgId);
  return Number(r.changes ?? 0) > 0 ? null : "مشتری پیدا نشد";
}
