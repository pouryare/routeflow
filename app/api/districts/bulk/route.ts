import { NextRequest, NextResponse } from "next/server";
import { getDb, District, logActivity } from "@/lib/db";
import { canReachGroup, orgScopeId, requireRole } from "@/lib/session";
import { recomputeCustomerGroups } from "@/lib/groups";
import { STATUS_LABEL } from "@/lib/types";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";


const VALID_STATUSES = ["visited", "needs_coverage", "not_allowed", "unknown"];

// Bulk sibling of PATCH /api/districts/[id] -- same per-row update + activity-log
// shape, just looped inside one transaction so a sweep across many districts (the
// desktop "select several, set them all at once" flow) is one atomic write instead
// of N separate requests.
export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
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

  const db = getDb();

  // Check every id before writing any of them. Silently skipping the out-of-scope ones
  // would return ok:true for a request that did not do what it said, and the caller would
  // have no way to tell a partial write from a whole one. 404, not 403, for the same
  // reason as the single-row route: a 403 confirms the districts exist.
  const scopeCheck = db.prepare("SELECT group_id FROM districts WHERE id = ?");
  for (const id of ids as number[]) {
    const row = scopeCheck.get(id) as { group_id: number | null } | undefined;
    if (!row) continue;
    if (!canReachGroup(session, row.group_id)) {
      return NextResponse.json({ ok: false, error: "منطقه پیدا نشد" }, { status: 404 });
    }
  }

  const actor = guard.session.user.display_name;
  const actorId = guard.session.user.id;
  const now = new Date().toISOString();
  let updated = 0;

  db.exec("BEGIN");
  try {
    const getStmt = db.prepare("SELECT * FROM districts WHERE id = ?");
    const sets: string[] = [];
    if (coverage_status !== undefined) sets.push("coverage_status = ?");
    if (group_id !== undefined) sets.push("group_id = ?");
    sets.push("updated_at = ?");
    const updateStmt = db.prepare(`UPDATE districts SET ${sets.join(", ")} WHERE id = ?`);

    for (const id of ids as number[]) {
      const existing = getStmt.get(id) as District | undefined;
      if (!existing) continue;

      const values: unknown[] = [];
      if (coverage_status !== undefined) values.push(coverage_status);
      if (group_id !== undefined) values.push(group_id ?? null);
      values.push(now, id);
      updateStmt.run(...(values as never[]));
      updated++;

      if (coverage_status !== undefined && coverage_status !== existing.coverage_status) {
        logActivity(db, {
          entity_type: "district",
          entity_id: id,
          event_type: "status_change",
          old_value: STATUS_LABEL[existing.coverage_status as keyof typeof STATUS_LABEL] ?? existing.coverage_status,
          new_value: STATUS_LABEL[coverage_status as keyof typeof STATUS_LABEL] ?? coverage_status,
          note: null,
          changed_by: actor,
          changed_by_user_id: actorId,
        });
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  // customers.group_id is a cache derived from which district contains each customer, so
  // moving territory has to drag the customers with it or they keep answering to the
  // previous owner. Runs after COMMIT because it opens its own transaction.
  let regrouped = 0;
  if (group_id !== undefined) regrouped = recomputeCustomerGroups(db, orgScopeId(guard.session));

  return NextResponse.json({ ok: true, updated, regrouped });
}
