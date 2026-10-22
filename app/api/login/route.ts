import { NextRequest, NextResponse } from "next/server";
import { createChallengeToken, createSessionToken, verifyPassword, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/auth";
import { secondFactorRequired } from "@/lib/repo/secondFactor";
import { clientKey, rateLimit, rateLimitReset } from "@/lib/rateLimit";
import { findUserByUsername } from "@/lib/users";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_MAX_ATTEMPTS_PER_IP = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// One message for "no such user", "wrong password" and "deactivated account". Telling
// them apart would turn this endpoint into a way to enumerate who works here.
const BAD_CREDENTIALS = "نام کاربری یا رمز عبور اشتباه است";
/* A well-formed salt:hash that no password matches. Verified against when the account is
   missing or deactivated, so those requests pay the same scrypt cost as a wrong password. Without
   it the identical message is undone by the clock: an unknown username answers in microseconds
   and a real one in tens of milliseconds, which lists who works here. */
const NO_ACCOUNT_HASH = `${"00".repeat(16)}:${"00".repeat(64)}`;

export async function POST(req: NextRequest) {
  const ip = clientKey(req);
  // Two buckets. The per-address one is generous: with no usable address every caller shares
  // "unknown", and a tight shared limit let one person's typos lock everybody out. The tight
  // limit is per address AND username, so guessing one account is slowed without one visitor
  // being able to lock a colleague out from another machine.
  const ipLimit = rateLimit(`login-ip:${ip}`, LOGIN_MAX_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS);
  const early = (await req.clone().json().catch(() => null)) as { username?: unknown } | null;
  const nameKey = typeof early?.username === "string" ? early.username.trim().toLowerCase().slice(0, 80) : "";
  const key = `login:${ip}:${nameKey}`;
  const limit = ipLimit.allowed ? rateLimit(key, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS) : ipLimit;
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
  const matches = verifyPassword(typeof password === "string" ? password : "", user?.password_hash ?? NO_ACCOUNT_HASH);
  if (!user || !user.active || typeof password !== "string" || !matches) {
    return NextResponse.json({ ok: false, error: BAD_CREDENTIALS }, { status: 401 });
  }

  rateLimitReset(key);

  /* The founder's account sees every company, so the password alone is not enough for it once a second
     step has been switched on. No session yet: only a short-lived proof the password passed, which the
     second-factor route turns into a session when the code checks out. */
  if (user.role === "platform_owner" && secondFactorRequired(user.id)) {
    return NextResponse.json({ ok: true, secondFactor: true, challenge: createChallengeToken(user.id) });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    COOKIE_NAME,
    createSessionToken({
      uid: user.id,
      role: user.role,
      gid: user.group_id,
      oid: user.organization_id,
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
