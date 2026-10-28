import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken } from "@/lib/auth";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { findUserById } from "@/lib/users";
import { beginEnrollment, confirmEnrollment, disableSecondFactor, secondFactorStatus } from "@/lib/repo/secondFactor";

/** Your own second step (an authenticator code on top of the password): status, enrol, confirm, switch
 *  off. Any signed-in person, never inside Login-As (an owner acting as someone must not be able to
 *  change that person's security). It also serves the sensitive-action codes (lib/stepUp.ts). */
async function selfOnly(req: NextRequest) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard;
  if (guard.session.actorId !== undefined) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "در حالت ورود به‌جای دیگران ممکن نیست" }, { status: 403 }) };
  }
  return guard;
}

/** The enrolment changes token_version, so the caller's own cookie is re-issued rather than logging them out. */
async function withFreshSession(res: NextResponse, userId: number): Promise<NextResponse> {
  const user = await findUserById(userId);
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
  const guard = await selfOnly(req);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, ...await secondFactorStatus(guard.session.user.id) });
}

export async function POST(req: NextRequest) {
  const guard = await selfOnly(req);
  if (!guard.ok) return guard.response;
  const userId = guard.session.user.id;

  const body = (await req.json().catch(() => null)) as { action?: unknown; code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";

  if (body?.action === "begin") {
    const started = await beginEnrollment(userId, guard.session.user.username);
    if (!started) return NextResponse.json({ ok: false, error: "مرحله دوم از قبل فعال است" }, { status: 409 });
    return NextResponse.json({ ok: true, secret: started.secret, uri: started.uri });
  }
  if (body?.action === "confirm") {
    const recovery = await confirmEnrollment(userId, code);
    if (!recovery) return NextResponse.json({ ok: false, error: "کد نادرست است" }, { status: 400 });
    return await withFreshSession(NextResponse.json({ ok: true, recoveryCodes: recovery }), userId);
  }
  if (body?.action === "disable") {
    if (!await disableSecondFactor(userId, code)) return NextResponse.json({ ok: false, error: "کد نادرست است" }, { status: 400 });
    return await withFreshSession(NextResponse.json({ ok: true }), userId);
  }
  return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
}
