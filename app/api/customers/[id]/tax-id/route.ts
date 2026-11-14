import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { customerGroupOf } from "@/lib/repo/payments";
import { setCustomerTaxId } from "@/lib/repo/invoice";

/** D7: a manager sets the customer's economic code or national ID { taxId: string | null }; an official invoice needs it. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/tax-id">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { taxId?: unknown } | null;
  if (!isId(id) || !b) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  const cust = await customerGroupOf(guard.session.organizationId, Number(id));
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  const refused = await setCustomerTaxId(guard.session.organizationId, Number(id), b.taxId);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
}
