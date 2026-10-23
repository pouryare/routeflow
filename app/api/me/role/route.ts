import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createSessionToken, COOKIE_NAME, MAX_AGE_SECONDS } from "@/lib/auth";
import { ROLES, type Role } from "@/lib/roles";

/** Make one of the roles this person already holds their active one.
 *
 *  The new role is a claim in the SIGNED cookie, not a side table, because proxy.ts cannot
 *  reach the database and the claim is the only thing it can read. `token_version` is
 *  deliberately NOT bumped: switching a hat must not log anyone out. */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ ok: false, error: "احراز هویت نشده" }, { status: 401 });
  }

  const role = (await req.json().catch(() => null))?.role as Role | undefined;
  // 400, not 403: "that is not a role" and "you may not have that role" are different
  // answers, and a caller sending garbage deserves to be told so.
  if (!role || !ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: "نقش نامعتبر" }, { status: 400 });
  }

  /* The one check that MUST be server-side. The token is signed, so the claim itself cannot
     be edited — but the role SET can change underneath a 30-day cookie, and this is where
     a removed role stops being switchable to. */
  if (!session.hasRole(role)) {
    return NextResponse.json({ ok: false, error: "این نقش برای شما ثبت نشده است" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(
    COOKIE_NAME,
    createSessionToken({
      uid: session.user.id,
      role,
      gid: session.user.group_id,
      tv: session.user.token_version,
      name: session.user.display_name,
      oid: session.organizationId,
      /* The impersonator rides along, so an owner acting as someone else keeps the banner
         and the attribution after switching the target's role. Dropping it would end the
         impersonation silently, mid-session. */
      ...(session.actorId !== undefined ? { act: session.actorId } : {}),
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
