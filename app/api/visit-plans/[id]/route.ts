import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { canReachEntity, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

const VALID_STATUSES = ["planned", "done", "skipped"];

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/visit-plans/[id]">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const planId = Number(id);
  if (!Number.isInteger(planId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const { status, planned_date, sort_order } = (body ?? {}) as {
    status?: string;
    planned_date?: string;
    sort_order?: number;
  };
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }

  const db = getDb();
  const owning = db.prepare("SELECT entity_type, entity_id FROM visit_plans WHERE id = ?").get(planId) as
    | { entity_type: string; entity_id: number }
    | undefined;
  if (!owning || !canReachEntity(guard.session, db, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "برنامه پیدا نشد" }, { status: 404 });
  }
  const existing = db.prepare("SELECT id FROM visit_plans WHERE id = ?").get(planId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: "برنامه پیدا نشد" }, { status: 404 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  if (status !== undefined) { sets.push("status = ?"); values.push(status); }
  if (planned_date !== undefined) { sets.push("planned_date = ?"); values.push(planned_date); }
  if (sort_order !== undefined) { sets.push("sort_order = ?"); values.push(sort_order); }
  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: "چیزی برای ذخیره نیست" }, { status: 400 });
  }
  values.push(planId);
  db.prepare(`UPDATE visit_plans SET ${sets.join(", ")} WHERE id = ?`).run(...(values as never[]));

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/visit-plans/[id]">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const planId = Number(id);
  if (!Number.isInteger(planId)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  }
  const db = getDb();
  const owning = db.prepare("SELECT entity_type, entity_id FROM visit_plans WHERE id = ?").get(planId) as
    | { entity_type: string; entity_id: number }
    | undefined;
  if (!owning || !canReachEntity(guard.session, db, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "برنامه پیدا نشد" }, { status: 404 });
  }
  db.prepare("DELETE FROM visit_plans WHERE id = ?").run(planId);
  return NextResponse.json({ ok: true });
}
