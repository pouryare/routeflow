import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { discountSettings, saveDiscountSettings, DiscountError } from "@/lib/repo/discounts";
import { OWNER_ROLES } from "@/lib/roles";
import { guardStepUp } from "@/lib/repo/stepUp";

/** The company's two discount settings: the percent below which a discount passes without approval,
 *  and how much of an approved discount comes out of commission. Owner only. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, settings: await discountSettings(guard.session.organizationId) });
}

export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const stepUp = await guardStepUp(req, guard.session, "owner_settings");
  if (stepUp) return stepUp;
  const body = (await req.json().catch(() => null)) as { auto_pass_pct?: unknown; commission_pct?: unknown } | null;
  const auto = Number(body?.auto_pass_pct);
  const commission = Number(body?.commission_pct);
  if (!Number.isFinite(auto) || !Number.isFinite(commission)) {
    return NextResponse.json({ ok: false, error: "مقدار نامعتبر است" }, { status: 400 });
  }
  try {
    await saveDiscountSettings(guard.session.organizationId, { auto_pass_pct: auto, commission_pct: commission });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DiscountError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
