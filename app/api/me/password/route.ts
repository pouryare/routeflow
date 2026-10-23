import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken, hashPassword, parseSessionToken, verifyPassword } from "@/lib/auth";
import { setOwnPassword } from "@/lib/repo/usersAdmin";
import { findUserById } from "@/lib/users";
import { rateLimit, rateLimitReset } from "@/lib/rateLimit";
import { MIN_PASSWORD } from "@/lib/userPatchPlan";

const CURRENT_MAX_ATTEMPTS = 5;
const CURRENT_WINDOW_MS = 15 * 60 * 1000;

/** Replace a password an owner chose (F35), or one's own at any time.
 *
 *  Every other session of this person ends (the token version moves on), and this device's
 *  cookie is re-issued with the new version and without the `pw` mark, so the proxy stops
 *  sending it to /password. Refused under Login-As: an owner acting as someone must not
 *  choose that person's password.
 *
 *  A change by choice (from /settings/security) must also name the CURRENT password, so a
 *  phone left unlocked on a counter is not enough to take the account over. The forced
 *  change (the cookie's `pw` mark) does not ask: the owner just handed that password over,
 *  and the person is standing at a form nothing else can be reached past. Guessing the
 *  current one is rate-limited per account, like the login it stands in for. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  if (session.actorId !== undefined) {
    return NextResponse.json({ ok: false, error: "در حالت ورود به‌جای دیگری نمی‌شود رمز را عوض کرد" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { password?: unknown; current?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: `رمز عبور باید حداقل ${MIN_PASSWORD} نویسه باشد` }, { status: 400 });
  }

  const claims = parseSessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (claims?.pw !== 1) {
    const key = `own-password:${session.user.id}`;
    const limit = rateLimit(key, CURRENT_MAX_ATTEMPTS, CURRENT_WINDOW_MS);
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: `تلاش‌های ناموفق زیاد بود. ${Math.ceil(limit.retryAfterSeconds / 60)} دقیقه دیگر دوباره امتحان کنید.` },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
      );
    }
    const current = typeof body?.current === "string" ? body.current : "";
    const stored = (await findUserById(session.user.id))?.password_hash ?? "";
    if (!current || !verifyPassword(current, stored)) {
      return NextResponse.json({ ok: false, error: "رمز فعلی درست نیست" }, { status: 400 });
    }
    if (current === password) {
      return NextResponse.json({ ok: false, error: "رمز تازه با رمز فعلی یکی است" }, { status: 400 });
    }
    rateLimitReset(key);
  }

  const tv = await setOwnPassword(session.user.id, hashPassword(password));
  const res = NextResponse.json({ ok: true });
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
