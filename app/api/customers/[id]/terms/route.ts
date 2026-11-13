import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { isTermKind } from "@/lib/paymentTerms";
import { customerGroupOf } from "@/lib/repo/payments";
import { setCreditTerms } from "@/lib/repo/customers";

/** D5: a manager sets how a customer pays: { kind: "cod" | "days" | "eom", days }. Applies to orders delivered from now on. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/terms">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { kind?: unknown; days?: unknown } | null;
  const days = b?.days;
  if (!isId(id) || !isTermKind(b?.kind) || typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > 365) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  const cust = await customerGroupOf(guard.session.organizationId, Number(id));
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  await setCreditTerms(guard.session.organizationId, Number(id), { payment_terms_kind: b!.kind as string, payment_terms_days: days });
  return NextResponse.json({ ok: true });
}
