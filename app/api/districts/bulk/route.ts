import { NextRequest, NextResponse } from "next/server";
import { getDb, District, logActivity } from "@/lib/db";
import { getActorName } from "@/lib/auth";
import { STATUS_LABEL } from "@/lib/types";

const VALID_STATUSES = ["visited", "needs_coverage", "not_allowed", "unknown"];

// Bulk sibling of PATCH /api/districts/[id] -- same per-row update + activity-log
// shape, just looped inside one transaction so a sweep across many districts (the
// desktop "select several, set them all at once" flow) is one atomic write instead
// of N separate requests.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { ids, coverage_status, assigned_to } = body ?? {};

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id))) {
    return NextResponse.json({ ok: false, error: "شناسه مناطق نامعتبر است" }, { status: 400 });
  }
  if (coverage_status !== undefined && !VALID_STATUSES.includes(coverage_status)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }
  if (coverage_status === undefined && assigned_to === undefined) {
    return NextResponse.json({ ok: false, error: "هیچ تغییری مشخص نشده" }, { status: 400 });
  }

  const db = getDb();
  const actor = getActorName(req);
  const now = new Date().toISOString();
  let updated = 0;

  db.exec("BEGIN");
  try {
    const getStmt = db.prepare("SELECT * FROM districts WHERE id = ?");
    const sets: string[] = [];
    if (coverage_status !== undefined) sets.push("coverage_status = ?");
    if (assigned_to !== undefined) sets.push("assigned_to = ?");
    sets.push("updated_at = ?");
    const updateStmt = db.prepare(`UPDATE districts SET ${sets.join(", ")} WHERE id = ?`);

    for (const id of ids as number[]) {
      const existing = getStmt.get(id) as District | undefined;
      if (!existing) continue;

      const values: unknown[] = [];
      if (coverage_status !== undefined) values.push(coverage_status);
      if (assigned_to !== undefined) values.push(assigned_to || null);
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
        });
      }
      if (assigned_to !== undefined && (assigned_to || null) !== existing.assigned_to) {
        logActivity(db, {
          entity_type: "district",
          entity_id: id,
          event_type: "assigned",
          old_value: existing.assigned_to,
          new_value: assigned_to || null,
          note: null,
          changed_by: actor,
        });
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return NextResponse.json({ ok: true, updated });
}
