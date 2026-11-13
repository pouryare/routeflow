import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { orderPageFor } from "@/lib/repo/ordersView";
import { setOrderOfficial } from "@/lib/repo/invoice";

/** D7: a manager marks a draft order as an official invoice, or takes the mark off { on: boolean }. The number is given at confirmation. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/sales/orders/[id]/official">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { on?: unknown } | null;
  if (!isId(id) || typeof b?.on !== "boolean") return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  if (!(await orderPageFor(guard.session, Number(id)))) return NextResponse.json({ ok: false, error: "سفارش پیدا نشد" }, { status: 404 });
  const refused = await setOrderOfficial(guard.session.organizationId, Number(id), b.on);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 409 }) : NextResponse.json({ ok: true });
}
