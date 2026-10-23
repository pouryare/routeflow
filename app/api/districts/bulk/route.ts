import { NextRequest, NextResponse } from "next/server";
import { groupExists } from "@/lib/repo/groupsAdmin";
import { anyUnreachable, bulkUpdateDistricts } from "@/lib/repo/districtsAdmin";
import { canReachGroup, orgScopeId, requireRole } from "@/lib/session";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";


const VALID_STATUSES = ["visited", "needs_coverage", "not_allowed", "unknown"];

// Bulk sibling of PATCH /api/districts/[id] -- same per-row update + activity-log
// shape, just looped inside one transaction so a sweep across many districts (the
// desktop "select several, set them all at once" flow) is one atomic write instead
// of N separate requests.
export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const body = await req.json().catch(() => null);
  const { ids, coverage_status, group_id } = body ?? {};

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id))) {
    return NextResponse.json({ ok: false, error: "شناسه مناطق نامعتبر است" }, { status: 400 });
  }
  if (coverage_status !== undefined && !VALID_STATUSES.includes(coverage_status)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }
  if (coverage_status === undefined && group_id === undefined) {
    return NextResponse.json({ ok: false, error: "هیچ تغییری مشخص نشده" }, { status: 400 });
  }
  // Handing territory between groups is an owner's decision. A manager who could set it
  // would be able to assign themselves someone else's districts, which is the whole
  // boundary this task exists to draw.
  if (group_id !== undefined && !isOwner(session.role)) {
    return NextResponse.json({ ok: false, error: "دسترسی لازم را ندارید" }, { status: 403 });
  }
  if (group_id !== undefined && group_id !== null && !Number.isInteger(group_id)) {
    return NextResponse.json({ ok: false, error: "شناسه گروه نامعتبر است" }, { status: 400 });
  }
  // Territory can only be handed to one of the caller's own company's groups.
  if (typeof group_id === "number" && !await groupExists(group_id, orgScopeId(session))) {
    return NextResponse.json({ ok: false, error: "گروه پیدا نشد" }, { status: 400 });
  }

  // Check every id before writing any of them. Silently skipping the out-of-scope ones
  // would return ok:true for a request that did not do what it said, and the caller would
  // have no way to tell a partial write from a whole one. 404, not 403, for the same
  // reason as the single-row route: a 403 confirms the districts exist.
  if (await anyUnreachable(ids as number[], async (g) => await canReachGroup(session, g))) {
    return NextResponse.json({ ok: false, error: "منطقه پیدا نشد" }, { status: 404 });
  }

  const { updated, regrouped } = await bulkUpdateDistricts(
    ids as number[],
    { coverage_status, group_id },
    { name: session.user.display_name, id: session.user.id },
    orgScopeId(session)
  );

  return NextResponse.json({ ok: true, updated, regrouped });
}
