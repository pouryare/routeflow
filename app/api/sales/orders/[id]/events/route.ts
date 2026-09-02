import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ordersRepo, orderEvents } from "@/lib/repo/orders";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/orders/[id]/events">) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!ordersRepo.get(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "سفارش پیدا نشد" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    events: orderEvents(guard.session.organizationId, Number(id)),
  });
}
