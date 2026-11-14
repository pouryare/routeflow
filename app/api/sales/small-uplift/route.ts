import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { guardStepUp } from "@/lib/repo/stepUp";
import { listUpliftRules, setUpliftRule } from "@/lib/repo/smallUplift";

const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, rules: await listUpliftRules(guard.session.organizationId) });
}

/** F65: { packaging_id, small_packs, percent } sets a pack's small-quantity rule; both null clears it. A rule changes prices, so it asks for the step-up code. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const stepUp = await guardStepUp(req, guard.session, "price_change");
  if (stepUp) return stepUp;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const packagingId = int(b?.packaging_id);
  const smallPacks = b?.small_packs === null ? null : int(b?.small_packs);
  const percent = b?.percent === null ? null : int(b?.percent);
  if (packagingId === null || (b?.small_packs !== null && smallPacks === null) || (b?.percent !== null && percent === null)) return bad("درخواست نامعتبر است");
  const refused = await setUpliftRule(guard.session.organizationId, packagingId, smallPacks, percent);
  return refused ? bad(refused) : NextResponse.json({ ok: true });
}
