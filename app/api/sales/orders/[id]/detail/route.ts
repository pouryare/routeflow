import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { canSeeRecord } from "@/lib/live/visibility";
import { isOrderDetailField } from "@/lib/orderEdits";
import { ChangeRequestError } from "@/lib/changeRequests";
import { changeOrderDetail } from "@/lib/repo/orderEdits";

/** F48 + F73: change a confirmed order's delivery day, due date, address or notes { field, value, reason }.
 *  The owner's change applies at once; a manager's waits for the owner. A reason is always required. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sales/orders/[id]/detail">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { field?: unknown; value?: unknown; reason?: unknown } | null;
  if (!isId(id) || !isOrderDetailField(b?.field) || typeof b?.reason !== "string") return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  if (!(await canSeeRecord(guard.session, "order", Number(id)))) return NextResponse.json({ ok: false, error: "سفارش پیدا نشد" }, { status: 404 });
  try {
    const result = await changeOrderDetail(guard.session.organizationId, Number(id), b.field, b.value, { id: guard.session.user.id, role: guard.session.role }, b.reason);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    if (e instanceof ChangeRequestError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
