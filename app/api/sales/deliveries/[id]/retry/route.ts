import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { retryDelivery, readDelivery, DeliveryEntityError } from "@/lib/repo/deliveries";
import { MANAGE_ROLES } from "@/lib/roles";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/sales/deliveries/[id]/retry">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!readDelivery(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }
  try {
    const newId = retryDelivery(guard.session.organizationId, Number(id), {
      id: guard.session.user.id,
      role: guard.session.role === "owner" ? "owner" : "group_manager",
    });
    return NextResponse.json({ ok: true, id: newId }, { status: 201 });
  } catch (e) {
    if (e instanceof DeliveryEntityError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
