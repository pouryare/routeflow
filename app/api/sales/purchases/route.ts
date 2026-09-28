import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { recordPurchase, PurchaseError, type PurchaseLineInput } from "@/lib/purchases";
import { OWNER_ROLES } from "@/lib/roles";

/** Owner only. Recording a purchase is recording that company money was spent, and it
 *  moves the average cost every future margin is measured against. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    supplier?: unknown;
    purchase_date?: unknown;
    invoice_no?: unknown;
    notes?: unknown;
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
    const id = recordPurchase(getDb(), {
      supplier: typeof body?.supplier === "string" ? body.supplier : null,
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
