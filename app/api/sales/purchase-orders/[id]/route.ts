import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { actOnPurchaseOrder, PurchaseOrderError } from "@/lib/repo/purchaseOrders";

/** { action: "send" | "cancel" | "close" }: send a draft, cancel one not yet received, or close a partly received one short. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sales/purchase-orders/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const b = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (b?.action !== "send" && b?.action !== "cancel" && b?.action !== "close") return NextResponse.json({ ok: false, error: "کار نامعتبر است" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, status: await actOnPurchaseOrder(guard.session.organizationId, Number(id), b.action) });
  } catch (e) {
    if (e instanceof PurchaseOrderError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
