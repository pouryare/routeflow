import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, verifyPassword, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/auth";
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
  const username = typeof body?.username === "string" ? body.username.trim() : "";

  // Named accounts are the only way in. The shared APP_PASSWORD login that used to sit
  // here is gone (spec §2.5, second release): every coworker has an account, and a
  // password several people know is not one anybody can be held to. The bootstrap path
  // for an owner locked out of their own account is scripts/create-user.mjs on the server.
  const user = username ? findUserByUsername(username) : null;
  if (!user || !user.active || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ ok: false, error: BAD_CREDENTIALS }, { status: 401 });
  }

  rateLimitReset(key);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    COOKIE_NAME,
    createSessionToken({
      uid: user.id,
      role: user.role,
      gid: user.group_id,
      tv: user.token_version,
      name: user.display_name,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: MAX_AGE_SECONDS,
      path: "/",
    }
  );
  return res;
}
