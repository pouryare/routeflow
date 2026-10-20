import { NextRequest, NextResponse } from "next/server";
import { getDb, VisitPlan, PLAN_ENTITY_TYPES, PlanEntityType, logActivity } from "@/lib/db";

const PLAN_STATUSES: VisitPlan["status"][] = ["planned", "done", "skipped"];
import { canReachEntity, entityGroupFilter, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";

interface PlanWithLabel extends VisitPlan {
  label: string;
  lat: number | null;
  lng: number | null;
}

function enrich(db: ReturnType<typeof getDb>, plans: VisitPlan[]): PlanWithLabel[] {
  const customerIds = plans.filter((p) => p.entity_type === "customer").map((p) => p.entity_id);
  const districtIds = plans.filter((p) => p.entity_type === "district").map((p) => p.entity_id);

  const customerMap = new Map<number, { business_name: string; lat: number | null; lng: number | null }>();
  if (customerIds.length) {
    const placeholders = customerIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, business_name, lat, lng FROM customers WHERE id IN (${placeholders})`)
      .all(...customerIds) as { id: number; business_name: string; lat: number | null; lng: number | null }[];
    rows.forEach((r) => customerMap.set(r.id, r));
  }

  const facilityIds = plans.filter((p) => p.entity_type === "facility").map((p) => p.entity_id);
  const facilityMap = new Map<number, { name: string; lat: number; lng: number }>();
  if (facilityIds.length) {
    const placeholders = facilityIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, name, lat, lng FROM facilities WHERE id IN (${placeholders})`)
      .all(...facilityIds) as { id: number; name: string; lat: number; lng: number }[];
    rows.forEach((r) => facilityMap.set(r.id, r));
  }

  const leadIds = plans.filter((p) => p.entity_type === "lead" || p.entity_type === "lead_location").map((p) => p.entity_id);
  const leadMap = new Map<number, { name: string; lat: number | null; lng: number | null }>();
  if (leadIds.length) {
    const placeholders = leadIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, name, lat, lng FROM saved_locations WHERE id IN (${placeholders})`)
      .all(...leadIds) as { id: number; name: string; lat: number | null; lng: number | null }[];
    rows.forEach((r) => leadMap.set(r.id, r));
  }

  const districtMap = new Map<number, { name: string }>();
  if (districtIds.length) {
    const placeholders = districtIds.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id, name FROM districts WHERE id IN (${placeholders})`)
      .all(...districtIds) as { id: number; name: string }[];
    rows.forEach((r) => districtMap.set(r.id, r));
  }

  return plans.map((p) => {
    if (p.entity_type === "customer") {
      const c = customerMap.get(p.entity_id);
      return { ...p, label: c?.business_name ?? "مشتری حذف‌شده", lat: c?.lat ?? null, lng: c?.lng ?? null };
    }
    if (p.entity_type === "facility") {
      const f = facilityMap.get(p.entity_id);
      return { ...p, label: f?.name ?? "مکان حذف‌شده", lat: f?.lat ?? null, lng: f?.lng ?? null };
    }
    if (p.entity_type === "lead" || p.entity_type === "lead_location") {
      const loc = leadMap.get(p.entity_id);
      return { ...p, label: loc?.name ?? "مکان حذف‌شده", lat: loc?.lat ?? null, lng: loc?.lng ?? null };
    }
    const d = districtMap.get(p.entity_id);
    return { ...p, label: d?.name ?? "منطقه حذف‌شده", lat: null, lng: null };
  });
}

// visit_plans is option 2: a stop is *at* a customer, district or facility.
// Reading is scoped by entityGroupFilter below, so the map's salesperson may read; writes stay with managers.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "rep_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;
  const f = entityGroupFilter(guard.session, "v");

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let rows: VisitPlan[];
  if (date) {
    rows = db
      .prepare(
        `SELECT v.* FROM visit_plans v${f.joins} WHERE v.planned_date = ?${f.sql} ORDER BY v.sort_order, v.id`
      )
      .all(date, ...f.params) as unknown as VisitPlan[];
  } else if (from && to) {
    rows = db
      .prepare(
        `SELECT v.* FROM visit_plans v${f.joins} WHERE v.planned_date BETWEEN ? AND ?${f.sql} ORDER BY v.planned_date, v.sort_order, v.id`
      )
      .all(from, to, ...f.params) as unknown as VisitPlan[];
  } else {
    rows = db
      .prepare(
        `SELECT v.* FROM visit_plans v${f.joins} WHERE 1 = 1${f.sql} ORDER BY v.planned_date, v.sort_order, v.id LIMIT 200`
      )
      .all(...f.params) as unknown as VisitPlan[];
  }

  return NextResponse.json({ ok: true, plans: enrich(db, rows) });
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

  const db = getDb();
  if (!canReachEntity(guard.session, db, entity_type, entity_id)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) as m FROM visit_plans WHERE planned_date = ?")
    .get(planned_date) as { m: number };

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO visit_plans (entity_type, entity_id, planned_date, status, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(entity_type, entity_id, planned_date, status ?? "planned", sort_order ?? maxOrder.m + 1, now);

  logActivity(db, {
    entity_type,
    entity_id,
    event_type: "note",
    old_value: null,
    new_value: null,
    note: sort_order === undefined ? `به برنامه بازدید ${planned_date} اضافه شد` : `به برنامه بازدید ${planned_date} بازگردانده شد`,
    changed_by: guard.session.user.display_name,
    changed_by_user_id: guard.session.user.id,
  });

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
