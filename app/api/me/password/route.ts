import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken, hashPassword, parseSessionToken } from "@/lib/auth";
import { setOwnPassword } from "@/lib/repo/usersAdmin";
import { MIN_PASSWORD } from "@/lib/userPatchPlan";

/** Replace a password an owner chose (F35), or one's own at any time.
 *
 *  Every other session of this person ends (the token version moves on), and this device's
 *  cookie is re-issued with the new version and without the `pw` mark, so the proxy stops
 *  sending it to /password. Refused under Login-As: an owner acting as someone must not
 *  choose that person's password. */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  if (session.actorId !== undefined) {
    return NextResponse.json({ ok: false, error: "در حالت ورود به‌جای دیگری نمی‌شود رمز را عوض کرد" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: `رمز عبور باید حداقل ${MIN_PASSWORD} نویسه باشد` }, { status: 400 });
  }

  const tv = setOwnPassword(session.user.id, hashPassword(password));
  const res = NextResponse.json({ ok: true });
  const claims = parseSessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (claims) {
    const { exp: _exp, pw: _pw, ...rest } = claims;
    void _exp;
    void _pw;
    res.cookies.set(COOKIE_NAME, createSessionToken({ ...rest, tv }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MAX_AGE_SECONDS,
      path: "/",
    });
  }
  return res;
}
