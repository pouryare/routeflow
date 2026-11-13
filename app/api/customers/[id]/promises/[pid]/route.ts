import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { customerGroupOf } from "@/lib/repo/payments";
import { cancelPromise } from "@/lib/repo/promises";

/** F50: cancel a promise that no longer stands (the customer changed the plan). */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/promises/[pid]">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep"]);
  if (!guard.ok) return guard.response;
  const { id, pid } = await ctx.params;
  if (!isId(id) || !isId(pid)) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  const cust = await customerGroupOf(guard.session.organizationId, Number(id));
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  return (await cancelPromise(guard.session.organizationId, Number(id), Number(pid)))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: "وعده پیدا نشد" }, { status: 404 });
}
