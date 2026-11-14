import { getDb } from "@/lib/db";
import { editRule } from "@/lib/orderEditRules";
import { editNote } from "@/lib/orderEditNote";
import { checkDetail, detailLabel, type OrderDetailField } from "@/lib/orderEdits";
import { isOwner, type Role } from "@/lib/roles";
import { faJalaliDate } from "@/lib/jalali";
import { appendOrderEvent } from "./orders";
import { ChangeRequestError } from "@/lib/changeRequests";
import { orderChangeLine } from "@/lib/orderChangeText";
import { noticeOrderChange } from "./orderChangeNotice";

const FIELD_COLUMN: Record<OrderDetailField, string> = { requested_day: "requested_day", due_date: "due_date", ship_address: "ship_address", notes: "notes" };

/** How a stored value reads on the timeline: dates in Jalali, empty as «ثبت نشده». */
const shown = (field: OrderDetailField, v: string | null): string => (v ? (field === "requested_day" || field === "due_date" ? faJalaliDate(v) : v) : "ثبت نشده");

/** Applies one detail change to an order, with the old and new value and the reason on its timeline (F73). */
export async function applyOrderDetail(orgId: number, orderId: number, field: OrderDetailField, value: string, actorId: number, reason: string, askedBy?: string): Promise<void> {
  const db = getDb();
  const row = (await db.prepare(`SELECT status, ${FIELD_COLUMN[field]} AS old FROM orders WHERE id = ? AND organization_id = ?`).get(orderId, orgId)) as { status: string; old: string | null } | undefined;
  if (!row) throw new ChangeRequestError("سفارش پیدا نشد");
  const rule = editRule("detail", row.status);
  if (!rule.ok) throw new ChangeRequestError(rule.why);
  await db.tx(async () => {
    await db.prepare(`UPDATE orders SET ${FIELD_COLUMN[field]} = ?, updated_at = ? WHERE id = ? AND organization_id = ?`).run(value, new Date().toISOString(), orderId, orgId);
    const note = `${editNote(detailLabel(field), shown(field, row.old), shown(field, value))} · دلیل: ${reason}${askedBy ? ` · درخواست ${askedBy}` : ""}`;
    await appendOrderEvent(db, { organization_id: orgId, order_id: orderId, from_status: row.status, to_status: row.status, action: "edit", actor_user_id: actorId, note });
    // FB24: a driver with this order still to deliver reads one line about what changed.
    await noticeOrderChange(orgId, orderId, orderChangeLine(field, shown(field, value)));
  });
}

/** A manager or the owner changes a confirmed order's delivery day, due date, address or notes. The owner's change applies
 *  at once; a manager's waits for the owner. A reason is always required. */
export async function changeOrderDetail(
  orgId: number,
  orderId: number,
  field: OrderDetailField,
  raw: unknown,
  actor: { id: number; role: Role },
  reason: string
): Promise<"applied" | "pending"> {
  const db = getDb();
  const row = (await db.prepare(`SELECT status, customer_id, ${FIELD_COLUMN[field]} AS old FROM orders WHERE id = ? AND organization_id = ?`).get(orderId, orgId)) as { status: string; customer_id: number; old: string | null } | undefined;
  if (!row) throw new ChangeRequestError("سفارش پیدا نشد");
  const rule = editRule("detail", row.status);
  if (!rule.ok) throw new ChangeRequestError(rule.why);
  const v = checkDetail(field, raw);
  if (!v.ok) throw new ChangeRequestError(v.why);
  if (v.value === row.old) throw new ChangeRequestError("مقدار تازه با مقدار فعلی یکی است");
  const why = reason.trim().slice(0, 300);
  if (!why) throw new ChangeRequestError("دلیل را بنویسید");
  if (isOwner(actor.role)) {
    await applyOrderDetail(orgId, orderId, field, v.value, actor.id, why);
    return "applied";
  }
  const open = await db.prepare("SELECT 1 FROM change_requests WHERE order_id = ? AND field = ? AND kind = 'order_edit' AND status = 'pending'").get(orderId, field);
  if (open) throw new ChangeRequestError("برای این مورد یک درخواست در انتظار هست");
  await db
    .prepare("INSERT INTO change_requests (organization_id, kind, customer_id, order_id, field, old_text, new_text, reason, requested_by, requested_at) VALUES (?, 'order_edit', ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(orgId, row.customer_id, orderId, field, row.old, v.value, why, actor.id, new Date().toISOString());
  return "pending";
}
