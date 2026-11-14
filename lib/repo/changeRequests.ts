import { getDb } from "@/lib/db";
import { ChangeRequestError, needsSignOff } from "@/lib/changeRequests";
export { ChangeRequestError };
import { isOwner, type Role } from "@/lib/roles";
import { setCreditTerms } from "./customers";
import { REQUEST_EXPIRY_DAYS, detailLabel, isOrderDetailField } from "@/lib/orderEdits";
import { faJalaliDate } from "@/lib/jalali";
import { applyOrderDetail } from "./orderEdits";

export interface PendingChange {
  id: number;
  kind: "credit_limit" | "order_edit";
  customer_id: number;
  customer_name: string;
  old_value: number | null;
  new_value: number | null;
  /** For an order edit: the order, what is changed, and the old and new value as they read. */
  order_id: number | null;
  order_no: string | null;
  field_label: string | null;
  old_text: string | null;
  new_text: string | null;
  reason: string;
  requested_by_name: string;
  requested_at: string;
}

/** Set a customer's credit limit. An owner, or any lowering, applies at once; a manager's raise waits for the owner. */
export async function changeCreditLimit(
  organizationId: number,
  customerId: number,
  newLimit: number | null,
  actor: { id: number; role: Role },
  reason: string,
): Promise<"applied" | "pending"> {
  const db = getDb();
  const row = (await db.prepare("SELECT credit_limit_toman FROM customers WHERE id = ? AND organization_id = ?").get(customerId, organizationId)) as { credit_limit_toman: number | null } | undefined;
  if (!row) throw new ChangeRequestError("مشتری پیدا نشد");
  const old = row.credit_limit_toman === null ? null : Number(row.credit_limit_toman);
  if (isOwner(actor.role) || !needsSignOff(old, newLimit)) {
    await setCreditTerms(organizationId, customerId, { credit_limit_toman: newLimit });
    return "applied";
  }
  if (!reason.trim()) throw new ChangeRequestError("دلیل را بنویسید");
  const open = await db.prepare("SELECT 1 FROM change_requests WHERE customer_id = ? AND kind = 'credit_limit' AND status = 'pending'").get(customerId);
  if (open) throw new ChangeRequestError("برای این مشتری یک درخواست در انتظار هست");
  await db
    .prepare("INSERT INTO change_requests (organization_id, kind, customer_id, old_value, new_value, reason, requested_by, requested_at) VALUES (?, 'credit_limit', ?, ?, ?, ?, ?, ?)")
    .run(organizationId, customerId, old, newLimit, reason.trim(), actor.id, new Date().toISOString());
  return "pending";
}

/** Requests nobody answered within the expiry window lapse; they can be asked again. */
async function expireOldChanges(organizationId: number): Promise<void> {
  const cutoff = new Date(Date.now() - REQUEST_EXPIRY_DAYS * 86_400_000).toISOString();
  await getDb()
    .prepare("UPDATE change_requests SET status = 'expired', decided_at = ?, decision_note = 'منقضی شد' WHERE organization_id = ? AND status = 'pending' AND requested_at < ?")
    .run(new Date().toISOString(), organizationId, cutoff);
}

export async function pendingChanges(organizationId: number): Promise<PendingChange[]> {
  await expireOldChanges(organizationId);
  const rows = (await getDb()
    .prepare(
      `SELECT r.id, r.kind, r.customer_id, c.business_name AS customer_name, r.old_value, r.new_value, r.order_id, o.order_no, r.field, r.old_text, r.new_text,
              r.reason, u.display_name AS requested_by_name, r.requested_at
         FROM change_requests r JOIN customers c ON c.id = r.customer_id JOIN users u ON u.id = r.requested_by LEFT JOIN orders o ON o.id = r.order_id
        WHERE r.organization_id = ? AND r.status = 'pending' ORDER BY r.requested_at`,
    )
    .all(organizationId)) as unknown as (PendingChange & { field: string | null })[];
  return rows.map((r) => {
    const f = isOrderDetailField(r.field) ? r.field : null;
    const date = f === "requested_day" || f === "due_date";
    const read = (t: string | null) => (t ? (date ? faJalaliDate(t) : t) : "ثبت نشده");
    return {
      id: Number(r.id), kind: r.kind, customer_id: Number(r.customer_id), customer_name: r.customer_name,
      old_value: r.old_value === null ? null : Number(r.old_value), new_value: r.new_value === null ? null : Number(r.new_value),
      order_id: r.order_id === null ? null : Number(r.order_id), order_no: r.order_no, field_label: f ? detailLabel(f) : null,
      old_text: f ? read(r.old_text) : null, new_text: f ? read(r.new_text) : null,
      reason: r.reason, requested_by_name: r.requested_by_name, requested_at: r.requested_at,
    };
  });
}

/** How many requests wait for the owner, for the action centre. */
export async function pendingChangeCount(organizationId: number): Promise<number> {
  await expireOldChanges(organizationId);
  const r = (await getDb().prepare("SELECT COUNT(*) AS n FROM change_requests WHERE organization_id = ? AND status = 'pending'").get(organizationId)) as { n: number };
  return Number(r.n);
}

/** The owner approves (the change is applied) or rejects a waiting request. The requester cannot decide their own. */
export async function decideChange(organizationId: number, id: number, verdict: "approved" | "rejected", actorId: number, note: string): Promise<void> {
  const db = getDb();
  await expireOldChanges(organizationId);
  const r = (await db.prepare("SELECT kind, customer_id, new_value, order_id, field, new_text, reason, requested_by, status FROM change_requests WHERE id = ? AND organization_id = ?").get(id, organizationId)) as
    | { kind: string; customer_id: number; new_value: number | null; order_id: number | null; field: string | null; new_text: string | null; reason: string; requested_by: number; status: string }
    | undefined;
  if (!r || r.status !== "pending") throw new ChangeRequestError("درخواست پیدا نشد، منقضی شده یا قبلاً تصمیم گرفته شده");
  if (Number(r.requested_by) === actorId) throw new ChangeRequestError("درخواست خودتان را نمی‌توانید تأیید کنید");
  if (verdict === "approved") {
    // Applied first: if the order can no longer be edited, the request stays pending and the owner can reject it.
    if (r.kind === "order_edit") {
      if (!isOrderDetailField(r.field) || r.order_id === null || r.new_text === null) throw new ChangeRequestError("درخواست نامعتبر است");
      const asker = (await db.prepare("SELECT display_name FROM users WHERE id = ?").get(r.requested_by)) as { display_name: string } | undefined;
      await applyOrderDetail(organizationId, Number(r.order_id), r.field, r.new_text, actorId, r.reason, asker?.display_name);
    } else await setCreditTerms(organizationId, Number(r.customer_id), { credit_limit_toman: r.new_value === null ? null : Number(r.new_value) });
  }
  await db
    .prepare("UPDATE change_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?")
    .run(verdict, actorId, new Date().toISOString(), note.trim().slice(0, 300) || null, id);
}
