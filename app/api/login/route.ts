import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionToken, verifyPassword, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/auth";
import { clientKey, rateLimit, rateLimitReset } from "@/lib/rateLimit";
import { findUserByUsername } from "@/lib/users";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// One message for "no such user", "wrong password" and "deactivated account". Telling
// them apart would turn this endpoint into a way to enumerate who works here.
const BAD_CREDENTIALS = "نام کاربری یا رمز عبور اشتباه است";

export async function POST(req: NextRequest) {
  const key = `login:${clientKey(req)}`;
  const limit = rateLimit(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `تعداد تلاش‌های ناموفق بیش از حد مجاز بود. ${Math.ceil(limit.retryAfterSeconds / 60)} دقیقه دیگر دوباره امتحان کنید.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const password = body?.password;
  const username = typeof body?.username === "string" ? body.username.trim() : null;

  let token: string;
  let sharedPasswordLogin = false;

  if (username) {
    const user = findUserByUsername(username);
    if (!user || !user.active || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ ok: false, error: BAD_CREDENTIALS }, { status: 401 });
    }
    token = createSessionToken({
      uid: user.id,
      role: user.role,
      gid: user.group_id,
      tv: user.token_version,
      name: user.display_name,
    });
  } else {
    // Migration path (spec §2.5, release one of two). The shared password still opens the
    // app, as an owner, so adding accounts cannot lock the team out mid-migration. uid 0
    // matches no row, so getSession() rejects it -- meaning this session can reach the
    // pages proxy.ts allows but not the API routes that resolve a real user. That is
    // deliberate: it is enough to reach the admin screens and create real accounts, and
    // not enough to be a permanent way in.
    if (typeof password !== "string" || !checkPassword(password)) {
      return NextResponse.json({ ok: false, error: BAD_CREDENTIALS }, { status: 401 });
    }
    const name = typeof body?.name === "string" ? body.name : "مدیر";
    token = createSessionToken({ uid: 0, role: "owner", gid: null, tv: 0, name });
    sharedPasswordLogin = true;
  }

  rateLimitReset(key);

  const res = NextResponse.json({ ok: true, shared_password_login: sharedPasswordLogin });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
