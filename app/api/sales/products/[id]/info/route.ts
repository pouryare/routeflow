import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { ProductInfoError, setProductInfo, type ProductInfoInput } from "@/lib/repo/productInfo";

/** The owner and managers write what reps say about a product; everyone who sells reads it through the
 *  catalogue. Cost and margin are not here and are never sent to a van role. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sales/products/[id]/info">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const productId = Number((await ctx.params).id);
  if (!Number.isInteger(productId)) return NextResponse.json({ ok: false, error: "شناسهٔ کالا معتبر نیست" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as ProductInfoInput | null;
  if (!body) return NextResponse.json({ ok: false, error: "درخواست نامعتبر" }, { status: 400 });
  try {
    await setProductInfo(guard.session, productId, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ProductInfoError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
}
