/* Leave (S23): a person is away until a date. The work they hold stays with them until the owner covers it
 * (handover, F59); what changes is that nobody is offered new work for them (assign lists skip people on leave).
 * The date is the LAST day away, a Tehran day, so a person is back the morning after. */
import { getDb } from "@/lib/db";
import { canReachUser, type Session } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { tehranTodayIso } from "@/lib/jalali";

export class LeaveError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

interface OnLeave {
  id: number;
  display_name: string;
  leave_until: string;
  leave_reason: string | null;
  delegate_name: string | null;
  customers: number;
  tasks: number;
}

/** SQL for "this user is at work today": add the Tehran day as the one parameter. Used by every assign list. */
export const AT_WORK_SQL = (col = "u") => `(${col}.leave_until IS NULL OR ${col}.leave_until < ?)`;

/** The last day away for a leave of `days` days starting today (a leave of 1 day ends today). */
function leaveEnd(days: number, today = tehranTodayIso()): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days - 1);
  return d.toISOString().slice(0, 10);
}

/** Mark a person away for `days` days from today (1 to 120), or back at work when `days` is null. */
export async function setLeave(s: Session, userId: number, days: number | null, reason: string | null, delegateId: number | null = null): Promise<void> {
  if (!MANAGE_ROLES.includes(s.role)) throw new LeaveError("فقط مدیر مرخصی ثبت می‌کند", 403);
  const db = getDb();
  const u = (await db.prepare("SELECT id FROM users WHERE id = ? AND organization_id = ?").get(userId, s.organizationId)) as { id: number } | undefined;
  if (!u || !(await canReachUser(s, userId))) throw new LeaveError("کاربر پیدا نشد", 404);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 120)) throw new LeaveError("مدت مرخصی باید بین ۱ تا ۱۲۰ روز باشد");
  const until = days === null ? null : leaveEnd(days);
  // F82: who decides this person's approvals while they are away. Only a colleague who can manage, not the person themselves.
  let delegate: number | null = null;
  if (until !== null && delegateId !== null) {
    const d = (await db.prepare("SELECT role FROM users WHERE id = ? AND organization_id = ? AND active = 1").get(delegateId, s.organizationId)) as { role: string } | undefined;
    if (!d || delegateId === userId || !(MANAGE_ROLES as readonly string[]).includes(d.role)) throw new LeaveError("جانشین باید مدیر دیگری باشد");
    delegate = delegateId;
  }
  await db
    .prepare("UPDATE users SET leave_until = ?, leave_reason = ?, leave_delegate_id = ? WHERE id = ? AND organization_id = ?")
    .run(until, until === null ? null : (reason?.trim().slice(0, 80) || null), delegate, userId, s.organizationId);
}

/** Who is away today, with what they still hold. A group manager sees their own group's people. */
export async function peopleOnLeave(s: Session): Promise<OnLeave[]> {
  if (!MANAGE_ROLES.includes(s.role)) throw new LeaveError("دسترسی ندارید", 403);
  const rows = (await getDb()
    .prepare(
      `SELECT u.id, u.display_name, u.leave_until, u.leave_reason,
              (SELECT d.display_name FROM users d WHERE d.id = u.leave_delegate_id) AS delegate_name,
              (SELECT COUNT(*) FROM customers c WHERE c.owner_user_id = u.id AND c.organization_id = u.organization_id) AS customers,
              (SELECT COUNT(*) FROM tasks t WHERE t.assignee_user_id = u.id AND t.organization_id = u.organization_id AND t.status = 'open') AS tasks
         FROM users u
        WHERE u.organization_id = ? AND u.active = 1 AND u.leave_until >= ?
        ORDER BY u.leave_until, u.display_name`
    )
    .all(s.organizationId, tehranTodayIso())) as unknown as OnLeave[];
  const out: OnLeave[] = [];
  for (const r of rows) if (await canReachUser(s, r.id)) out.push({ ...r, customers: Number(r.customers), tasks: Number(r.tasks) });
  return out;
}
