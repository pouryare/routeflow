import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { isCompanyFx } from "@/lib/fx";
import { setEffects } from "@/lib/repo/effects";

/** The company's switch for decorative effects. Owner only; members read it from GET /api/prefs. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { effects?: unknown } | null;
  if (!isCompanyFx(body?.effects)) return NextResponse.json({ ok: false, error: "مقدار نامعتبر است" }, { status: 400 });
  await setEffects(guard.session.organizationId, body.effects);
  return NextResponse.json({ ok: true, effects: body.effects });
}
