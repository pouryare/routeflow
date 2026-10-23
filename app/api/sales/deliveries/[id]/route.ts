import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { readDelivery } from "@/lib/repo/deliveries";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/deliveries/[id]">) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const delivery = await readDelivery(guard.session.organizationId, Number(id));
  if (!delivery) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, delivery });
}
