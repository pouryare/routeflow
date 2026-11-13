import { getDb } from "@/lib/db";
import { canSetPriority, priorityLabel, type SettablePriority } from "../orderPriority";
import { editNote } from "../orderEditNote";
import { appendOrderEvent } from "./orders";

/** Set an open order's priority (F132). False when the order is not this organisation's or is
 *  already finished. `updated_at` moves so the phones' offline copy picks the change up. */
export async function setOrderPriority(organizationId: number, orderId: number, priority: SettablePriority, actorId: number | null = null): Promise<boolean> {
  const db = getDb();
  const row = await db.prepare("SELECT status, priority FROM orders WHERE id = ? AND organization_id = ?").get(orderId, organizationId) as
    | { status: string; priority: string | null }
    | undefined;
  if (!row || !canSetPriority(row.status)) return false;
  await db.prepare("UPDATE orders SET priority = ?, updated_at = ? WHERE id = ? AND organization_id = ?").run(
    priority,
    new Date().toISOString(),
    orderId,
    organizationId
  );
  // F73: the change shows on the order's timeline with the old and the new value.
  if (row.priority !== priority) {
    await appendOrderEvent(db, { organization_id: organizationId, order_id: orderId, from_status: row.status, to_status: row.status, action: "edit", actor_user_id: actorId, note: editNote("اولویت", priorityLabel(row.priority), priorityLabel(priority)) });
  }
  return true;
}
