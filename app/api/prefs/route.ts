import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getPrefs, setPrefs, type BoardPrefs } from "@/lib/repo/prefs";
import { companyLookFor } from "@/lib/repo/effects";

/** Self-service UI prefs. Every authenticated non-platform role may read and write their
 *  own; there is no cross-user access here. GET also carries the company's sound skin (F117),
 *  which every member hears but only the owner sets (/api/admin/sound-settings). */
const SELF_ROLES = ["platform_owner", "owner", "group_manager", "rep_manager", "phone_sales", "field_rep", "delivery_driver"] as const;

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...SELF_ROLES]);
  if (!guard.ok) return guard.response;
  const look = await companyLookFor(guard.session.organizationId);
  return NextResponse.json({
    ok: true,
    prefs: await getPrefs(guard.session.user.id),
    soundSkin: look.soundSkin,
    effects: look.effects,
  });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, [...SELF_ROLES]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as BoardPrefs | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "تنظیمات نامعتبر است" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, prefs: await setPrefs(guard.session.user.id, body) });
  } catch {
    return NextResponse.json({ ok: false, error: "تنظیمات نامعتبر است" }, { status: 400 });
  }
}
