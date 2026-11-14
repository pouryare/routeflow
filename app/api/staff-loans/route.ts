import { NextRequest, NextResponse } from "next/server";
import { once } from "@/lib/repo/idempotency";
import { requireRole } from "@/lib/session";
import { isOwner, MANAGE_ROLES } from "@/lib/roles";
import { decideAdvanceRequest, giveAdvance, LoanError, recordLoanRepayment, requestAdvance, writeOffLoan, type PayMethod } from "@/lib/repo/staffLoans";

/** Staff advances and loans. One route, one action per call:
 *  request (a group manager asks for someone in their group), and for the owner only: give, decide, repay, writeoff.
 *  Who may do what is decided here, not by the screen that shows the button. */
async function post(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const s = guard.session;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : NaN);
  const method = (v: unknown): PayMethod | null => (v === "CASH" || v === "TRANSFER" ? v : null);
  const note = typeof b?.note === "string" ? b.note : null;
  const hint = b?.monthly_hint === null || b?.monthly_hint === undefined || b?.monthly_hint === "" ? null : num(b.monthly_hint);
  const bad = () => NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  try {
    if (b?.action === "request") {
      const id = await requestAdvance({ organizationId: s.organizationId, userId: s.user.id, groupId: s.groupId }, { userId: num(b.user_id), amountToman: num(b.amount_toman), note, monthlyHint: hint });
      return NextResponse.json({ ok: true, id }, { status: 201 });
    }
    if (!isOwner(s.role)) return NextResponse.json({ ok: false, error: "این کار فقط برای مالک است" }, { status: 403 });
    if (b?.action === "give") {
      const m = method(b.method);
      if (!m) return bad();
      const id = await giveAdvance(s.organizationId, s.user.id, { userId: num(b.user_id), amountToman: num(b.amount_toman), method: m, note, monthlyHint: hint });
      return NextResponse.json({ ok: true, id }, { status: 201 });
    }
    if (b?.action === "decide") {
      if (b.verdict === "approve") {
        const m = method(b.method);
        if (!m) return bad();
        await decideAdvanceRequest(s.organizationId, s.user.id, num(b.id), { verdict: "approve", method: m });
      } else if (b.verdict === "reject") {
        await decideAdvanceRequest(s.organizationId, s.user.id, num(b.id), { verdict: "reject", reason: typeof b.reason === "string" ? b.reason : "" });
      } else return bad();
      return NextResponse.json({ ok: true });
    }
    if (b?.action === "repay") {
      const m = method(b.method);
      if (!m) return bad();
      await recordLoanRepayment(s.organizationId, s.user.id, { userId: num(b.user_id), amountToman: num(b.amount_toman), method: m, note });
      return NextResponse.json({ ok: true });
    }
    if (b?.action === "writeoff") {
      await writeOffLoan(s.organizationId, s.user.id, { userId: num(b.user_id), amountToman: num(b.amount_toman), reason: typeof b.reason === "string" ? b.reason : "" });
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    if (e instanceof LoanError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
  return bad();
}
export const POST = (req: NextRequest) => once(req, () => post(req));
