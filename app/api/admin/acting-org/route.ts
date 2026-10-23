import { NextRequest, NextResponse } from "next/server";
import { listOrganizations, findOrganization, logActingOrgSwitch } from "@/lib/repo/organizations";
import { COOKIE_NAME, MAX_AGE_SECONDS, createSessionToken, parseSessionToken } from "@/lib/auth";
import { requireRole } from "@/lib/session";

/* The acting company of a platform_owner (the founder's account).
 *
 * With no acting company the account sees every company at once (the default). Choosing one makes
 * the session behave as that company's OWNER for reads AND writes: every screen, the catalogue,
 * the staff list, new records, all of it is that company's. Choosing «همه» goes back.
 *
 * Only a real platform_owner session may call this: not an owner, not a Login-As session (that one
 * is exactly the person it impersonates). Each switch into a company other than the current one is
 * written to platform_access_log. The claim lives in the signed session token and is re-validated
 * against the database on every request (lib/session.ts). */

const cookieBase = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" };

async function guard(req: NextRequest) {
  const g = await requireRole(req, ["platform_owner"]);
  if (!g.ok) return g;
  if (g.session.actorId !== undefined) {
    return { ok: false as const, response: NextResponse.json({ ok: false, error: "در حالت ورود به‌جای کاربر دیگر نمی‌توان سازمان را عوض کرد" }, { status: 403 }) };
  }
  return g;
}

/** GET: the companies to choose from, and which one is acting now (null = all). */
export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (!g.ok) return g.response;
  return NextResponse.json({ ok: true, organizations: await listOrganizations(), acting: g.session.actingOrg ?? null, home: g.session.user.organization_id });
}

/** POST { organization_id }: act as that company's owner; null (or 0) goes back to all companies. */
export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (!g.ok) return g.response;
  const own = req.cookies.get(COOKIE_NAME)?.value;
  const claims = parseSessionToken(own);
  if (!claims) return NextResponse.json({ ok: false, error: "نشست شما معتبر نیست" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { organization_id?: unknown } | null;
  const raw = body?.organization_id;
  const wanted = raw === null || raw === 0 || raw === undefined ? null : Number(raw);
  if (wanted !== null && !Number.isInteger(wanted)) {
    return NextResponse.json({ ok: false, error: "سازمان نامعتبر است" }, { status: 400 });
  }

  if (wanted !== null) {
    const org = await findOrganization(wanted);
    if (!org || !org.active) return NextResponse.json({ ok: false, error: "سازمان پیدا نشد" }, { status: 404 });
    await logActingOrgSwitch(g.session, wanted);
  }

  // Rebuilt field by field: expiry restarts, and neither Login-As (`act`) nor a previous choice (`ao`) carries over.
  const token = createSessionToken({
    uid: claims.uid,
    role: claims.role,
    gid: claims.gid,
    oid: claims.oid,
    tv: claims.tv,
    name: claims.name,
    ...(wanted !== null ? { ao: wanted } : {}),
  });
  const res = NextResponse.json({ ok: true, acting: wanted });
  res.cookies.set(COOKIE_NAME, token, { ...cookieBase, maxAge: MAX_AGE_SECONDS });
  return res;
}
