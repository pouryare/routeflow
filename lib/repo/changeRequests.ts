import { getDb } from "@/lib/db";
import { needsSignOff } from "@/lib/changeRequests";
import { isOwner, type Role } from "@/lib/roles";
import { setCreditTerms } from "./customers";

export class ChangeRequestError extends Error {}

export interface PendingChange {
  id: number;
  customer_id: number;
  customer_name: string;
  old_value: number | null;
  new_value: number | null;
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

export async function pendingChanges(organizationId: number): Promise<PendingChange[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT r.id, r.customer_id, c.business_name AS customer_name, r.old_value, r.new_value, r.reason, u.display_name AS requested_by_name, r.requested_at
         FROM change_requests r JOIN customers c ON c.id = r.customer_id JOIN users u ON u.id = r.requested_by
        WHERE r.organization_id = ? AND r.status = 'pending' ORDER BY r.requested_at`,
    )
    .all(organizationId)) as unknown as PendingChange[];
  return rows.map((r) => ({ ...r, id: Number(r.id), customer_id: Number(r.customer_id), old_value: r.old_value === null ? null : Number(r.old_value), new_value: r.new_value === null ? null : Number(r.new_value) }));
}

/** The owner approves (the change is applied) or rejects a waiting request. The requester cannot decide their own. */
export async function decideChange(organizationId: number, id: number, verdict: "approved" | "rejected", actorId: number, note: string): Promise<void> {
  const db = getDb();
  const r = (await db.prepare("SELECT customer_id, new_value, requested_by, status FROM change_requests WHERE id = ? AND organization_id = ?").get(id, organizationId)) as
    | { customer_id: number; new_value: number | null; requested_by: number; status: string }
    | undefined;
  if (!r || r.status !== "pending") throw new ChangeRequestError("درخواست پیدا نشد یا قبلاً تصمیم گرفته شده");
  if (Number(r.requested_by) === actorId) throw new ChangeRequestError("درخواست خودتان را نمی‌توانید تأیید کنید");
  await db
    .prepare("UPDATE change_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?")
    .run(verdict, actorId, new Date().toISOString(), note.trim().slice(0, 300) || null, id);
  if (verdict === "approved") await setCreditTerms(organizationId, Number(r.customer_id), { credit_limit_toman: r.new_value === null ? null : Number(r.new_value) });
}
