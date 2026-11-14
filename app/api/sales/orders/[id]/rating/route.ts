import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { orderPageFor } from "@/lib/repo/ordersView";
import { rateDelivery } from "@/lib/repo/deliveryRatings";

/** F45: the rep enters how the customer said the delivery was { stars: 1-5, reason? }. Reaches only orders this person may see. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/sales/orders/[id]/rating">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { stars?: unknown; reason?: unknown } | null;
  if (!isId(id) || !b) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  if (!(await orderPageFor(guard.session, Number(id)))) return NextResponse.json({ ok: false, error: "سفارش پیدا نشد" }, { status: 404 });
  const refused = await rateDelivery(guard.session.organizationId, Number(id), guard.session.user.id, b);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
}
