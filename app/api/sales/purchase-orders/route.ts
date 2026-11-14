import { NextRequest, NextResponse } from "next/server";
import { once } from "@/lib/repo/idempotency";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { createPurchaseOrder, listPurchaseOrders, PurchaseOrderError } from "@/lib/repo/purchaseOrders";

/** F66, owner only: a purchase order commits company money to a supplier, like the purchase it ends in. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, orders: await listPurchaseOrders(guard.session.organizationId, { open: req.nextUrl.searchParams.get("open") === "1" }) });
}

async function post(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { supplier_id?: unknown; expected_date?: unknown; notes?: unknown; send?: unknown; lines?: unknown } | null;
  if (!Number.isInteger(b?.supplier_id)) return NextResponse.json({ ok: false, error: "تأمین‌کننده را انتخاب کنید" }, { status: 400 });
  const lines = Array.isArray(b?.lines) ? (b.lines as { product_id?: unknown; base_qty?: unknown; unit_cost_toman?: unknown }[]) : [];
  try {
    const id = await createPurchaseOrder(guard.session.organizationId, {
      supplier_id: b!.supplier_id as number,
      expected_date: typeof b?.expected_date === "string" && b.expected_date ? b.expected_date : null,
      notes: typeof b?.notes === "string" ? b.notes : null,
      created_by: guard.session.user.id,
      send: b?.send === true,
      lines: lines.map((l) => ({ product_id: Number(l.product_id), base_qty: Number(l.base_qty), unit_cost_toman: Number(l.unit_cost_toman ?? 0) })),
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof PurchaseOrderError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
export const POST = (req: NextRequest) => once(req, () => post(req));
