import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { rateLimit } from "@/lib/rateLimit";
import { checkSecondFactor, secondFactorRequired } from "@/lib/repo/secondFactor";
import { trustCookieFor, verifierOf } from "@/lib/repo/stepUp";
import { normaliseCode } from "@/lib/stepUp";

/** Checks the person's own authenticator code (or an unused recovery code) and trusts this device for
 *  ten minutes. Each code is usable once. Five wrong tries in ten minutes pause the person. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  const person = verifierOf(session);

  if (!await secondFactorRequired(person)) {
    return NextResponse.json({ ok: false, error: "ورود دومرحله‌ای هنوز فعال نیست؛ از «امنیت حساب» فعالش کنید" }, { status: 409 });
  }
  const limit = rateLimit(`stepup:${person}`, 5, 10 * 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: `تلاش‌های ناموفق زیاد بود؛ ${Math.ceil(limit.retryAfterSeconds / 60)} دقیقه دیگر دوباره امتحان کنید` }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = normaliseCode(typeof body?.code === "string" ? body.code : "");
  if (!code || !await checkSecondFactor(person, code)) {
    return NextResponse.json({ ok: false, error: "کد نادرست است" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, trustMinutes: 10 });
  const c = await trustCookieFor(person);
  res.cookies.set(c.name, c.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: c.maxAge, path: "/" });
  return res;
}
