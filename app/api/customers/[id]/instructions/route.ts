import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { customerGroupOf } from "@/lib/repo/payments";
import { setDeliveryInstructions } from "@/lib/repo/deliveryInstructions";
import { setCodeRequired } from "@/lib/repo/deliveryCode";

/** F69: the standing note for the driver at one customer { text }. An empty text clears it. F120: { code_required } turns the delivery code on or off for the customer. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/instructions">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { text?: unknown; code_required?: unknown } | null;
  if (!isId(id) || (typeof b?.text !== "string" && typeof b?.code_required !== "boolean")) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  const cust = await customerGroupOf(guard.session.organizationId, Number(id));
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  const refused = typeof b.code_required === "boolean"
    ? await setCodeRequired(guard.session.organizationId, Number(id), b.code_required)
    : await setDeliveryInstructions(guard.session.organizationId, Number(id), b.text as string);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
}
