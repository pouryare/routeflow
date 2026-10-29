import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { ordersRepo, orderEvents } from "@/lib/repo/orders";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/orders/[id]/events">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  if (!await ordersRepo.get(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "سفارش پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    events: await orderEvents(guard.session.organizationId, Number(id)),
  });
}
