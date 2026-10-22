import { NextRequest, NextResponse } from "next/server";
import { deletePlan, planEntity, updatePlan } from "@/lib/repo/visitPlans";
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

  const owning = planEntity(planId);
  if (!owning || !canReachEntity(guard.session, owning.entity_type, owning.entity_id)) {
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
  updatePlan(planId, sets, values);

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
  const owning = planEntity(planId);
  if (!owning || !canReachEntity(guard.session, owning.entity_type, owning.entity_id)) {
    return NextResponse.json({ ok: false, error: "برنامه پیدا نشد" }, { status: 404 });
  }
  deletePlan(planId);
  return NextResponse.json({ ok: true });
}
