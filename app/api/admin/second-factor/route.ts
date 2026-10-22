import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken } from "@/lib/auth";
import { requireRole } from "@/lib/session";
import { findUserById } from "@/lib/users";
import { beginEnrollment, confirmEnrollment, disableSecondFactor, secondFactorStatus } from "@/lib/repo/secondFactor";

/** The founder's own second login step: status, enrol, confirm, switch off. Only a real platform_owner
 *  session, never inside Login-As (an owner acting as someone must not be able to change the founder's
 *  security). */
function founderOnly(req: NextRequest) {
  const guard = requireRole(req, ["platform_owner"]);
  if (!guard.ok) return guard;
  if (guard.session.actorId !== undefined) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "در حالت ورود به‌جای دیگران ممکن نیست" }, { status: 403 }) };
  }
  return guard;
}

/** The enrolment changes token_version, so the caller's own cookie is re-issued rather than logging them out. */
function withFreshSession(res: NextResponse, userId: number): NextResponse {
  const user = findUserById(userId);
  if (user) {
    res.cookies.set(
      COOKIE_NAME,
      createSessionToken({ uid: user.id, role: user.role, gid: user.group_id, oid: user.organization_id, tv: user.token_version, name: user.display_name }),
      { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE_SECONDS, path: "/" }
    );
  }
  return res;
}

export async function GET(req: NextRequest) {
  const guard = founderOnly(req);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, ...secondFactorStatus(guard.session.user.id) });
}

export async function POST(req: NextRequest) {
  const guard = founderOnly(req);
  if (!guard.ok) return guard.response;
  const userId = guard.session.user.id;

  const body = (await req.json().catch(() => null)) as { action?: unknown; code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";

  if (body?.action === "begin") {
    const started = beginEnrollment(userId, guard.session.user.username);
    if (!started) return NextResponse.json({ ok: false, error: "مرحله دوم از قبل فعال است" }, { status: 409 });
    return NextResponse.json({ ok: true, secret: started.secret, uri: started.uri });
  }
  if (body?.action === "confirm") {
    const recovery = confirmEnrollment(userId, code);
    if (!recovery) return NextResponse.json({ ok: false, error: "کد نادرست است" }, { status: 400 });
    return withFreshSession(NextResponse.json({ ok: true, recoveryCodes: recovery }), userId);
  }
  if (body?.action === "disable") {
    if (!disableSecondFactor(userId, code)) return NextResponse.json({ ok: false, error: "کد نادرست است" }, { status: 400 });
    return withFreshSession(NextResponse.json({ ok: true }), userId);
  }
  return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
}
