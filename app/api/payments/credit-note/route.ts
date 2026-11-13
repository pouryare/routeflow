import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { customerGroupOf, PaymentError } from "@/lib/repo/payments";
import { issueCreditNote } from "@/lib/repo/creditNote";
import { once } from "@/lib/repo/idempotency";

/** B1: a manager credits a customer for returned goods: { customer_id, amount_toman, reason }. */
async function post(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { customer_id?: unknown; amount_toman?: unknown; reason?: unknown } | null;
  if (!isId(String(body?.customer_id ?? ""))) return NextResponse.json({ ok: false, error: "مشتری نامعتبر است" }, { status: 400 });
  const customerId = Number(body?.customer_id);
  const cust = await customerGroupOf(guard.session.organizationId, customerId);
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  try {
    const id = await issueCreditNote(guard.session, customerId, body?.amount_toman, body?.reason);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    if (e instanceof PaymentError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}

export const POST = (req: NextRequest) => once(req, () => post(req));
