import { getDb } from "@/lib/db";
import { canSetPriority, type SettablePriority } from "../orderPriority";

/** Set an open order's priority (F132). False when the order is not this organisation's or is
 *  already finished. `updated_at` moves so the phones' offline copy picks the change up. */
export async function setOrderPriority(organizationId: number, orderId: number, priority: SettablePriority): Promise<boolean> {
  const db = getDb();
  const row = await db.prepare("SELECT status FROM orders WHERE id = ? AND organization_id = ?").get(orderId, organizationId) as
    | { status: string }
    | undefined;
  if (!row || !canSetPriority(row.status)) return false;
  await db.prepare("UPDATE orders SET priority = ?, updated_at = ? WHERE id = ? AND organization_id = ?").run(
    priority,
    new Date().toISOString(),
    orderId,
    organizationId
  );
  return true;
}
