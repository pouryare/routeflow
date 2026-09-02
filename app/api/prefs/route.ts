import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getPrefs, setPrefs, type BoardPrefs } from "@/lib/repo/prefs";

/** Self-service UI prefs. Every authenticated non-platform role may read and write their
 *  own; there is no cross-user access here. */
const SELF_ROLES = ["owner", "group_manager", "rep_manager", "salesperson", "driver"] as const;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...SELF_ROLES]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, prefs: getPrefs(guard.session.user.id) });
}

export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, [...SELF_ROLES]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as BoardPrefs | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "تنظیمات نامعتبر است" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, prefs: setPrefs(guard.session.user.id, body) });
  } catch {
    return NextResponse.json({ ok: false, error: "تنظیمات نامعتبر است" }, { status: 400 });
  }
}
