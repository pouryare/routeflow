import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { impersonatableIn, logAccess } from "@/lib/repo/routeAdapters";
import { OWNER_ROLES } from "@/lib/roles";

/** GET /api/admin/impersonatable — the account switcher's list, across EVERY tenant.
 *
 *  Owner and platform_owner. An owner sees their own organisation, as before; a
 *  platform_owner sees everyone, because diagnosing a customer he does not work for is
 *  what the role is for.
 *
 *  Listing another tenant's staff IS a cross-tenant read, so it is logged — the same
 *  treatment the spec gives a platform_owner reading tenant data, and the reason this
 *  feature is accountable rather than invisible. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;

  const users = await impersonatableIn(orgScopeId(guard.session));

  // A platform_owner only; logPlatformAccess returns immediately for anyone else, so
  // this is not a per-row cost for an ordinary owner.
  for (const u of users) {
    await logAccess(guard.session, "/api/admin/impersonatable", u.organization_id);
  }

  const self = guard.session.user.id;
  return NextResponse.json({
    ok: true,
    selfId: self,
    users: users.map((u) => ({
      ...u,
      // Not selectable: switching into yourself is refused by impersonationRefusal, so
      // offering it would be a row that always errors.
      isSelf: u.id === self,
    })),
  });
}
