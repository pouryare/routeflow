import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { customerGroupOf } from "@/lib/repo/payments";
import { changeCreditLimit, ChangeRequestError } from "@/lib/repo/changeRequests";
import { guardStepUp } from "@/lib/repo/stepUp";

/** F48: set a customer's credit limit { limit: number | null, reason }. A manager's raise waits for the owner. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/credit-limit">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const stepUp = await guardStepUp(req, guard.session, "credit_limit");
  if (stepUp) return stepUp;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { limit?: unknown; reason?: unknown } | null;
  const limit = b?.limit;
  if (!isId(id) || !(limit === null || (typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 0)) || (b?.reason !== undefined && typeof b.reason !== "string")) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  const cust = await customerGroupOf(guard.session.organizationId, Number(id));
  if (!cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  try {
    const result = await changeCreditLimit(guard.session.organizationId, Number(id), limit, { id: guard.session.user.id, role: guard.session.role }, (b?.reason as string | undefined) ?? "");
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (e instanceof ChangeRequestError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
