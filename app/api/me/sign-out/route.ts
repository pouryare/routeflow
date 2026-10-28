import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken, parseSessionToken } from "@/lib/auth";
import { TRUST_COOKIE } from "@/lib/stepUp";
import { bumpTokenVersion } from "@/lib/repo/userSessions";

/** Sign out everywhere (F107). A plain form post from /settings/security, so it works
 *  without JavaScript and answers with a redirect.
 *
 *  `scope=others` keeps this device: the cookie is re-issued with the new token version and
 *  every other claim unchanged (role, acting company). `scope=all` ends this device too.
 *  Refused under Login-As: an owner acting as someone must not sign that person out of
 *  their own phone. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  const back = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  if (!session) return back("/login");
  if (session.actorId !== undefined) return back("/settings/security?error=impersonating");

  const form = await req.formData().catch(() => null);
  const scope = form?.get("scope") === "all" ? "all" : "others";
  const tv = await bumpTokenVersion(session.user.id);

  if (scope === "all") {
    const res = back("/login");
    res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    res.cookies.set(TRUST_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  const claims = parseSessionToken(req.cookies.get(COOKIE_NAME)?.value);
  const res = back("/settings/security?done=others");
  if (claims) {
    const { exp: _exp, ...rest } = claims;
    void _exp;
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
