import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken, parseChallengeToken } from "@/lib/auth";
import { clientKey, rateLimit, rateLimitReset } from "@/lib/rateLimit";
import { findUserById } from "@/lib/users";
import { checkSecondFactor } from "@/lib/repo/secondFactor";
import { recordLogin } from "@/lib/repo/loginEvents";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const REFUSED = "کد نادرست است یا منقضی شده";

/** Second step of the founder's sign-in: the proof the password passed plus a code from the authenticator
 *  app (or an unused recovery code). Public like /api/login, because no session exists yet. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { challenge?: unknown; code?: unknown } | null;
  const uid = parseChallengeToken(body?.challenge);
  if (uid === null || typeof body?.code !== "string") {
    return NextResponse.json({ ok: false, error: REFUSED }, { status: 401 });
  }

  // Per account as well as per address: six digits is a small space, so guesses are slowed hard.
  const limit = rateLimit(`2fa:${uid}`, MAX_ATTEMPTS, WINDOW_MS);
  const ipLimit = rateLimit(`2fa-ip:${clientKey(req)}`, 30, WINDOW_MS);
  if (!limit.allowed || !ipLimit.allowed) {
    const wait = Math.max(limit.retryAfterSeconds, ipLimit.retryAfterSeconds);
    return NextResponse.json(
      { ok: false, error: `تعداد تلاش‌ها بیش از حد مجاز بود. ${Math.ceil(wait / 60)} دقیقه دیگر دوباره امتحان کنید.` },
      { status: 429, headers: { "Retry-After": String(wait) } }
    );
  }

  const user = await findUserById(uid);
  const log = async (result: "success" | "bad_code") => {
    if (user?.organization_id != null) {
      await recordLogin({ organizationId: user.organization_id, userId: user.id, result, ip: clientKey(req), userAgent: req.headers.get("user-agent") });
    }
  };
  if (!user || !user.active || user.role !== "platform_owner" || !await checkSecondFactor(user.id, body.code)) {
    if (user) await log("bad_code");
    return NextResponse.json({ ok: false, error: REFUSED }, { status: 401 });
  }
  rateLimitReset(`2fa:${uid}`);
  await log("success");

  const res = NextResponse.json({ ok: true });
  res.cookies.set(
    COOKIE_NAME,
    createSessionToken({ uid: user.id, role: user.role, gid: user.group_id, oid: user.organization_id, tv: user.token_version, name: user.display_name, ...(user.must_change_password ? { pw: 1 as const } : {}) }),
    { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: MAX_AGE_SECONDS, path: "/" }
  );
  return res;
}
