import { NextRequest, NextResponse } from "next/server";
import { VisitPlan, PLAN_ENTITY_TYPES, PlanEntityType } from "@/lib/db";
import { addPlan, listPlans } from "@/lib/repo/visitPlans";

const PLAN_STATUSES: VisitPlan["status"][] = ["planned", "done", "skipped"];
import { canReachEntity, entityGroupFilter, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

// visit_plans is option 2: a stop is *at* a customer, district or facility.
// Reading is scoped by entityGroupFilter below, so the map's salesperson may read; writes stay with managers.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "rep_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;
  const f = entityGroupFilter(guard.session, "v");

  const { searchParams } = new URL(req.url);
  const plans = listPlans(f, { date: searchParams.get("date"), from: searchParams.get("from"), to: searchParams.get("to") });

  return NextResponse.json({ ok: true, plans });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => null);
  const { entity_type, entity_id, planned_date, sort_order, status } = (body ?? {}) as {
    entity_type?: PlanEntityType;
    entity_id?: number;
    planned_date?: string;
    /** Undo only. A normal add appends; a restore has to land back where it was, and
     *  DELETE does not renumber the rows around it, so the original value still fits
     *  the gap it left. */
    sort_order?: number;
    /** Undo only, for the same reason: removing a stop you had already marked done and
     *  then undoing must not quietly reset it to planned. */
    status?: VisitPlan["status"];
  };

  if (!entity_type || !PLAN_ENTITY_TYPES.includes(entity_type)) {
    return NextResponse.json({ ok: false, error: "نوع موجودیت نامعتبر است" }, { status: 400 });
  }
  if (typeof entity_id !== "number" || !Number.isInteger(entity_id)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }
  if (!planned_date || !/^\d{4}-\d{2}-\d{2}$/.test(planned_date)) {
    return NextResponse.json({ ok: false, error: "تاریخ نامعتبر است" }, { status: 400 });
  }

  if (status !== undefined && !PLAN_STATUSES.includes(status)) {
    return NextResponse.json({ ok: false, error: "وضعیت نامعتبر است" }, { status: 400 });
  }
  if (sort_order !== undefined && !Number.isInteger(sort_order)) {
    return NextResponse.json({ ok: false, error: "ترتیب نامعتبر است" }, { status: 400 });
  }

  if (!canReachEntity(guard.session, entity_type, entity_id)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const id = addPlan(
    { entity_type, entity_id, planned_date, status, sort_order },
    { name: guard.session.user.display_name, id: guard.session.user.id }
  );

  return NextResponse.json({ ok: true, id });
}
