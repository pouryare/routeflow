import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { setProductVat } from "@/lib/repo/invoice";

/** D7: the owner gives a product its own VAT rate { vatPct: 0..100 }, or null to follow the company's rate. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sales/products/[id]/vat">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const v = ((await req.json().catch(() => null)) as { vatPct?: unknown } | null)?.vatPct;
  if (!isId(id) || !(v === null || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100))) {
    return NextResponse.json({ ok: false, error: "درصد مالیات بین ۰ تا ۱۰۰ است" }, { status: 400 });
  }
  return (await setProductVat(guard.session.organizationId, Number(id), v))
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ ok: false, error: "کالا پیدا نشد" }, { status: 404 });
}
