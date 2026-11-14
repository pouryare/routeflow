import { NextRequest, NextResponse } from "next/server";
import { once } from "@/lib/repo/idempotency";
import { requireRole } from "@/lib/session";
import { PurchaseError, type PurchaseLineInput } from "@/lib/purchases";
import { recordPurchaseFor } from "@/lib/repo/salesWrites";
import { OWNER_ROLES } from "@/lib/roles";
import { supplierOfOrder } from "@/lib/repo/purchaseOrders";

/** Owner only. Recording a purchase is recording that company money was spent, and it
 *  moves the average cost every future margin is measured against. */
async function post(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    supplier?: unknown;
    purchase_date?: unknown;
    invoice_no?: unknown;
    notes?: unknown;
    purchase_order_id?: unknown;
    lines?: unknown;
  } | null;

  const purchaseDate = typeof body?.purchase_date === "string" ? body.purchase_date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) || Number.isNaN(Date.parse(purchaseDate))) {
    return NextResponse.json({ ok: false, error: "تاریخ خرید معتبر نیست" }, { status: 400 });
  }

  const lines = Array.isArray(body?.lines) ? (body.lines as PurchaseLineInput[]) : [];
  if (lines.length === 0) {
    return NextResponse.json({ ok: false, error: "خرید بدون قلم ثبت نمی‌شود" }, { status: 400 });
  }

  try {
    // F66: against a purchase order the supplier is the order's, not what the form says.
    const order = Number.isInteger(body?.purchase_order_id) ? await supplierOfOrder(guard.session.organizationId, body!.purchase_order_id as number) : null;
    if (Number.isInteger(body?.purchase_order_id) && !order) return NextResponse.json({ ok: false, error: "سفارش خرید پیدا نشد" }, { status: 404 });
    const id = await recordPurchaseFor({
      supplier: order ? order.name : typeof body?.supplier === "string" ? body.supplier : null,
      supplier_id: order?.id ?? null,
      purchase_order_id: order ? (body!.purchase_order_id as number) : null,
      purchase_date: purchaseDate,
      invoice_no: typeof body?.invoice_no === "string" ? body.invoice_no : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
      created_by: guard.session.user.id,
      organization_id: guard.session.organizationId,
      lines: lines.map((line) => ({
        product_id: Number(line.product_id),
        base_qty: Number(line.base_qty),
        unit_cost_toman: Number(line.unit_cost_toman),
      })),
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    // PurchaseError is a refusal to show the user; TypeError is a fractional Toman,
    // which is the same class of thing from the caller's point of view.
    if (e instanceof PurchaseError || e instanceof TypeError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}

/** Z2: a repeat with the same Idempotency-Key returns the first answer and saves nothing. */
export const POST = (req: NextRequest) => once(req, () => post(req));
