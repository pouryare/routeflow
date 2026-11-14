import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { actOnPurchaseOrder, scheduleArrival, PurchaseOrderError } from "@/lib/repo/purchaseOrders";
import { isSlot } from "@/lib/purchaseOrders";

/** { action: "send" | "cancel" | "close" }: send a draft, cancel one not yet received, or close a partly received one short. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sales/purchase-orders/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { action?: unknown; expected_date?: unknown; slot?: unknown } | null;
  /* F87: { action: "schedule", expected_date, slot? } says when the truck comes. */
  if (b?.action === "schedule") {
    if (typeof b.expected_date !== "string" || (b.slot != null && !isSlot(b.slot))) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
    const refused = await scheduleArrival(guard.session.organizationId, Number(id), b.expected_date, isSlot(b.slot) ? b.slot : null);
    return refused ? NextResponse.json({ ok: false, error: refused }, { status: 409 }) : NextResponse.json({ ok: true });
  }
  if (b?.action !== "send" && b?.action !== "cancel" && b?.action !== "close") return NextResponse.json({ ok: false, error: "کار نامعتبر است" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, status: await actOnPurchaseOrder(guard.session.organizationId, Number(id), b.action) });
  } catch (e) {
    if (e instanceof PurchaseOrderError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
