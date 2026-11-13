import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { customerGroupOf } from "@/lib/repo/payments";
import { createPromise } from "@/lib/repo/promises";

/** F50: note a customer's promise to pay { amount, date }. Managers and the people who sell to the customer. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/promises">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { amount?: unknown; date?: unknown } | null;
  if (!isId(id) || !b) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  const cust = await customerGroupOf(guard.session.organizationId, Number(id));
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  const refused = await createPromise(guard.session.organizationId, Number(id), b.amount, b.date, guard.session.user.id);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
}
