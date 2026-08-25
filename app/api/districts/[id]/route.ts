import { NextRequest, NextResponse } from "next/server";
import { getDb, District, logActivity } from "@/lib/db";
import { canReachGroup, requireRole } from "@/lib/session";
import { STATUS_LABEL } from "@/lib/types";

const VALID_STATUSES = ["visited", "needs_coverage", "not_allowed", "unknown"];

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/districts/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const districtId = Number(id);
  if (!Number.isInteger(districtId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const { coverage_status, notes } = body ?? {};
  if (coverage_status !== undefined && !VALID_STATUSES.includes(coverage_status)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const existing = db.prepare("SELECT * FROM districts WHERE id = ?").get(districtId) as District | undefined;
  // 404 rather than 403 for a district in another group. A 403 would confirm the row
  // exists, which itself tells a manager how the province is carved up and who holds what.
  if (!existing || !canReachGroup(guard.session, existing.group_id)) {
    return NextResponse.json({ ok: false, error: "منطقه پیدا نشد" }, { status: 404 });
  }

  const actor = guard.session.user.display_name;
  const actorId = guard.session.user.id;
  const now = new Date().toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (coverage_status !== undefined) {
    sets.push("coverage_status = ?");
    values.push(coverage_status);
  }
  if (notes !== undefined) {
    sets.push("notes = ?");
    values.push(notes);
  }
  sets.push("updated_at = ?");
  values.push(now);
  values.push(districtId);

  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE districts SET ${sets.join(", ")} WHERE id = ?`).run(...(values as never[]));

    if (coverage_status !== undefined && coverage_status !== existing.coverage_status) {
      logActivity(db, {
        entity_type: "district",
        entity_id: districtId,
        event_type: "status_change",
        old_value: STATUS_LABEL[existing.coverage_status as keyof typeof STATUS_LABEL] ?? existing.coverage_status,
        new_value: STATUS_LABEL[coverage_status as keyof typeof STATUS_LABEL] ?? coverage_status,
        note: null,
        changed_by: actor,
        changed_by_user_id: actorId,
      });
    }
    if (notes !== undefined && notes !== existing.notes && notes) {
      logActivity(db, {
        entity_type: "district",
        entity_id: districtId,
        event_type: "note",
        old_value: null,
        new_value: null,
        note: notes,
        changed_by: actor,
        changed_by_user_id: actorId,
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/districts/[id]">) {
  const { id } = await ctx.params;
  const districtId = Number(id);
  if (!Number.isInteger(districtId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const db = getDb();
  const row = db.prepare("SELECT is_custom FROM districts WHERE id = ?").get(districtId) as
    | { is_custom: number }
    | undefined;
  if (!row) {
    return NextResponse.json({ ok: false, error: "منطقه پیدا نشد" }, { status: 404 });
  }
  if (!row.is_custom) {
    return NextResponse.json(
      { ok: false, error: "این منطقه از پیش‌فرض‌های نقشه است و قابل حذف نیست" },
      { status: 403 }
    );
  }
  db.prepare("DELETE FROM districts WHERE id = ?").run(districtId);
  return NextResponse.json({ ok: true });
}
