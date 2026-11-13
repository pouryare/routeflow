import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { deleteSupplierPrice, saveSupplierPrice } from "@/lib/repo/supplierPrices";

type Ctx = RouteContext<"/api/accounting/suppliers/[id]/prices">;
const posInt = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0;

/** D16: PUT { product_id, price_toman, min_qty?, delivery_days?, supplier_code? } adds or changes a row; DELETE { product_id } removes it. */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const minQty = b?.min_qty ?? null;
  const days = b?.delivery_days ?? null;
  if (!isId(id) || !posInt(b?.product_id) || !posInt(b?.price_toman) || (minQty !== null && !(typeof minQty === "number" && minQty > 0)) || (days !== null && !(typeof days === "number" && Number.isInteger(days) && days >= 0 && days <= 365)) || (b?.supplier_code != null && (typeof b.supplier_code !== "string" || b.supplier_code.length > 60))) {
    return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  }
  const ok = await saveSupplierPrice(guard.session.organizationId, Number(id), { product_id: b!.product_id as number, price_toman: b!.price_toman as number, min_qty: minQty as number | null, delivery_days: days as number | null, supplier_code: (b!.supplier_code as string | null | undefined) ?? null });
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: "تأمین‌کننده یا کالا پیدا نشد" }, { status: 404 });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => null)) as { product_id?: unknown } | null;
  if (!isId(id) || !posInt(b?.product_id)) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  await deleteSupplierPrice(guard.session.organizationId, Number(id), b!.product_id as number);
  return NextResponse.json({ ok: true });
}
