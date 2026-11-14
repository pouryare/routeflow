import { NextRequest, NextResponse } from "next/server";
import { once } from "@/lib/repo/idempotency";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { loadVanChecked, VanStockError } from "@/lib/repo/vanStock";

/** F30 first slice: a manager moves stock from the warehouse onto a van (two movements, refused when the warehouse is short). */
async function post(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { facility_id?: unknown; product_id?: unknown; qty?: unknown } | null;
  const facilityId = Number(b?.facility_id), productId = Number(b?.product_id), qty = Number(b?.qty);
  if (!Number.isInteger(facilityId) || !Number.isInteger(productId) || !Number.isFinite(qty)) {
    return NextResponse.json({ ok: false, error: "وانت، کالا و تعداد را بنویسید" }, { status: 400 });
  }
  try {
    await loadVanChecked(guard.session.organizationId, { facilityId, productId, qty, actorId: guard.session.user.id });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (e instanceof VanStockError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
export const POST = (req: NextRequest) => once(req, () => post(req));
