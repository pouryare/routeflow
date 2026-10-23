import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { productInOrg } from "@/lib/repo/catalogueAdmin";
import { setThresholds } from "@/lib/repo/routeAdapters";
import { OWNER_ROLES } from "@/lib/roles";
import { logProductChange, productThresholds, thresholdText } from "@/lib/repo/productLog";

/** Owner only, same split as every other write in the catalogue: everyone who sells
 *  reads a reorder gauge, only the owner decides where its lines sit. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const productId = Number(id);
  if (!Number.isInteger(productId)) {
    return NextResponse.json({ ok: false, error: "شناسهٔ کالا معتبر نیست" }, { status: 400 });
  }

  if (!productInOrg(productId, orgScopeId(guard.session))) {
    return NextResponse.json({ ok: false, error: "کالا پیدا نشد" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    reorder_point?: unknown;
    target_stock?: unknown;
  } | null;

  const input: { reorder_point?: number | null; target_stock?: number | null } = {};
  if (body && "reorder_point" in body) {
    input.reorder_point = body.reorder_point === null ? null : Number(body.reorder_point);
  }
  if (body && "target_stock" in body) {
    input.target_stock = body.target_stock === null ? null : Number(body.target_stock);
  }

  try {
    const before = productThresholds(productId);
    setThresholds(productId, input);
    const after = productThresholds(productId);
    if (before.reorder_point !== after.reorder_point || before.target_stock !== after.target_stock) {
      logProductChange(productId, "thresholds", { old: thresholdText(before), new: thresholdText(after) }, { id: guard.session.user.id, name: guard.session.user.display_name, impersonatedBy: guard.session.actorId ?? null });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof TypeError ? e.message : "ثبت آستانه ممکن نشد";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
