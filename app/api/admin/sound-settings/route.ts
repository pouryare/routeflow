import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { isSkin } from "@/lib/soundRecipes";
import { setSoundSkin } from "@/lib/repo/soundSkin";

/** The company's sound skin (F117): how every member's taps, saves and errors sound. Owner only;
 *  members read it from GET /api/prefs. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { skin?: unknown } | null;
  if (!isSkin(body?.skin)) return NextResponse.json({ ok: false, error: "صدای انتخاب‌شده نامعتبر است" }, { status: 400 });
  await setSoundSkin(guard.session.organizationId, body.skin);
  return NextResponse.json({ ok: true, skin: body.skin });
}
