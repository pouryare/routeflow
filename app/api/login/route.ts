import { NextRequest, NextResponse } from "next/server";
import { checkPassword, createSessionToken, verifyPassword, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/auth";
import { clientKey, rateLimit, rateLimitReset } from "@/lib/rateLimit";
import { findUserByUsername } from "@/lib/users";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

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
  if (username) {
    // Named-account path: a real per-coworker login, additive alongside the shared
    // password below -- it can never lock the team out, since the shared password
    // keeps working exactly as it always has.
    const user = username ? findUserByUsername(username) : null;
    if (!user || typeof password !== "string" || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ ok: false, error: "نام کاربری یا رمز عبور اشتباه است" }, { status: 401 });
    }
    token = createSessionToken({
      uid: user.id,
      role: user.role,
      gid: user.group_id,
      tv: user.token_version,
      name: user.display_name,
    });
  } else {
    const name = typeof body?.name === "string" ? body.name : "مدیر";
    if (typeof password !== "string" || !checkPassword(password)) {
      return NextResponse.json({ ok: false, error: "رمز عبور اشتباه است" }, { status: 401 });
    }
    token = createSessionToken({ uid: 0, role: "owner", gid: null, tv: 0, name });
  }

  rateLimitReset(key);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
