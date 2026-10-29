import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { retryDelivery, readDelivery, DeliveryEntityError } from "@/lib/repo/deliveries";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";


export async function POST(req: NextRequest, ctx: RouteContext<"/api/sales/deliveries/[id]/retry">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  if (!await readDelivery(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }
  try {
    const newId = await retryDelivery(guard.session.organizationId, Number(id), {
      id: guard.session.user.id,
      role: isOwner(guard.session.role) ? "owner" : "group_manager",
    });
    return NextResponse.json({ ok: true, id: newId }, { status: 201 });
  } catch (e) {
    if (e instanceof DeliveryEntityError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
