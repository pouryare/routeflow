import { NextRequest, NextResponse } from "next/server";
import { withDbScope } from "@/lib/database/scope";
import { impersonationTarget } from "@/lib/repo/routeAdapters";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken, parseSessionToken } from "@/lib/auth";
import { getSessionFromCookies, requireRole } from "@/lib/session";
import { emitEvent } from "@/lib/repo/events";
import { ACTOR_COOKIE, IMPERSONATION_MAX_AGE_SECONDS, impersonationRefusal } from "@/lib/impersonation";
import { OWNER_ROLES, type Role } from "@/lib/roles";
import { rolesFor } from "@/lib/repo/userRoles";

const cookieBase = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" };

/** POST /api/admin/impersonate { user_id }: an owner starts seeing the app as one of
 *  their people (spec slice N, Login-As).
 *
 *  The session cookie is replaced by one in the target's name that also carries `act`,
 *  the owner's id: lib/session.ts re-checks that the actor is still an active owner of the
 *  same organisation on every request, and the header shows a banner with the way back.
 *  The owner's own session waits in ACTOR_COOKIE (httpOnly, two hours). Both the start
 *  and the end are written to the events log with the owner as the actor. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const own = req.cookies.get(COOKIE_NAME)?.value;
  const body = (await req.json().catch(() => null)) as { user_id?: unknown } | null;
  const targetId = Number(body?.user_id);

  const target = await impersonationTarget(targetId);
  const refusal = impersonationRefusal(
    { id: guard.session.user.id, role: guard.session.role, organization_id: guard.session.organizationId, active: guard.session.user.active },
    target,
  );
  if (refusal || !target || !own) {
    return NextResponse.json({ ok: false, error: refusal ?? "نشست شما معتبر نیست" }, { status: 403 });
  }

  /* The impersonated session starts at the target's PRIMARY role, so the founder lands where
     that person lands by default — not at a random pick from their set. */
  const held = await rolesFor(target.id);
  const primary = held.includes(target.role as never) ? (target.role as Role) : (held[0] ?? (target.role as Role));

  const token = createSessionToken({
    uid: target.id,
    role: primary,
    gid: target.group_id,
    oid: target.organization_id,
    tv: target.token_version,
    name: target.display_name,
    act: guard.session.user.id,
  });
  /* The full set travels with the session, so the founder can switch the target's active
     role from the picker without ending the impersonation. Without it, a dual-hat driver
     could only ever be seen as one of their two hats. */
  await emitEvent(guard.session.organizationId, {
    kind: "auth.impersonation_started",
    entity_type: "user",
    entity_id: target.id,
    actor_user_id: guard.session.user.id,
  });

  const res = NextResponse.json({ ok: true, name: target.display_name });
  res.cookies.set(COOKIE_NAME, token, { ...cookieBase, maxAge: IMPERSONATION_MAX_AGE_SECONDS });
  res.cookies.set(ACTOR_COOKIE, own, { ...cookieBase, maxAge: IMPERSONATION_MAX_AGE_SECONDS });
  return res;
}

/** DELETE /api/admin/impersonate: back to the owner's own session.
 *
 *  Not role-guarded (the caller is, by definition, currently someone else); instead the
 *  saved owner session must itself still be valid, and the current session must be an
 *  impersonation by that same owner. Anything else clears both cookies: a stale or forged
 *  pair ends signed out, never signed in as somebody. */
/** Runs as "system" for row-level security (lib/database/scope.ts): the saved owner session belongs to another company than the cookie in force; it is checked here before anything is written. */
export async function DELETE(req: NextRequest) {
  return await withDbScope("system", () => endImpersonation(req));
}

async function endImpersonation(req: NextRequest) {
  const current = parseSessionToken(req.cookies.get(COOKIE_NAME)?.value);
  const savedToken = req.cookies.get(ACTOR_COOKIE)?.value;
  const owner = await getSessionFromCookies(savedToken);

  const res = NextResponse.json({ ok: true });
  // The saved session may belong to a platform_owner as well as an owner — the founder
  // switching into another tenant must still be able to come back out of it.
  if (!current?.act || !owner || !savedToken || !OWNER_ROLES.includes(owner.role) || owner.user.id !== current.act) {
    res.cookies.set(COOKIE_NAME, "", { ...cookieBase, maxAge: 0 });
    res.cookies.set(ACTOR_COOKIE, "", { ...cookieBase, maxAge: 0 });
    return res;
  }

  await emitEvent(owner.organizationId, {
    kind: "auth.impersonation_ended",
    entity_type: "user",
    entity_id: current.uid,
    actor_user_id: owner.user.id,
  });
  res.cookies.set(COOKIE_NAME, savedToken, { ...cookieBase, maxAge: MAX_AGE_SECONDS });
  res.cookies.set(ACTOR_COOKIE, "", { ...cookieBase, maxAge: 0 });
  return res;
}
