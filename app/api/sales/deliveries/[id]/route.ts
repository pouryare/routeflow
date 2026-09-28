import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { readDelivery } from "@/lib/repo/deliveries";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/deliveries/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager", "phone_sales", "field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const delivery = readDelivery(guard.session.organizationId, Number(id));
  if (!delivery) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, delivery });
}
