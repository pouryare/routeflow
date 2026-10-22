/** Visit plans: dated stops at a customer, district, facility or saved pin. A plan row carries no
 *  company of its own; it is scoped through the entity it points at (see `entityGroupFilter` and
 *  `canReachEntity` in lib/session.ts), which the callers apply before anything here runs. */

import { getDb, logActivity, type PlanEntityType, type VisitPlan } from "@/lib/db";

export interface PlanWithLabel extends VisitPlan {
  label: string;
  lat: number | null;
  lng: number | null;
}

function enrich(plans: VisitPlan[]): PlanWithLabel[] {
  const db = getDb();
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

type Filter = { joins: string; sql: string; params: number[] };

/** Plans on one date, in a date range, or the next 200; `filter` is the caller's entityGroupFilter("v"). */
export function listPlans(filter: Filter, when: { date?: string | null; from?: string | null; to?: string | null }): PlanWithLabel[] {
  const db = getDb();
  let rows: VisitPlan[];
  if (when.date) {
    rows = db
      .prepare(`SELECT v.* FROM visit_plans v${filter.joins} WHERE v.planned_date = ?${filter.sql} ORDER BY v.sort_order, v.id`)
      .all(when.date, ...filter.params) as unknown as VisitPlan[];
  } else if (when.from && when.to) {
    rows = db
      .prepare(`SELECT v.* FROM visit_plans v${filter.joins} WHERE v.planned_date BETWEEN ? AND ?${filter.sql} ORDER BY v.planned_date, v.sort_order, v.id`)
      .all(when.from, when.to, ...filter.params) as unknown as VisitPlan[];
  } else {
    rows = db
      .prepare(`SELECT v.* FROM visit_plans v${filter.joins} WHERE 1 = 1${filter.sql} ORDER BY v.planned_date, v.sort_order, v.id LIMIT 200`)
      .all(...filter.params) as unknown as VisitPlan[];
  }
  return enrich(rows);
}

export function addPlan(
  p: { entity_type: PlanEntityType; entity_id: number; planned_date: string; status?: VisitPlan["status"]; sort_order?: number },
  actor: { name: string; id: number }
): number {
  const db = getDb();
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), -1) as m FROM visit_plans WHERE planned_date = ?").get(p.planned_date) as { m: number };
  const result = db
    .prepare(`INSERT INTO visit_plans (entity_type, entity_id, planned_date, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(p.entity_type, p.entity_id, p.planned_date, p.status ?? "planned", p.sort_order ?? maxOrder.m + 1, new Date().toISOString());
  logActivity(db, {
    entity_type: p.entity_type,
    entity_id: p.entity_id,
    event_type: "note",
    old_value: null,
    new_value: null,
    note: p.sort_order === undefined ? `به برنامه بازدید ${p.planned_date} اضافه شد` : `به برنامه بازدید ${p.planned_date} بازگردانده شد`,
    changed_by: actor.name,
    changed_by_user_id: actor.id,
  });
  return Number(result.lastInsertRowid);
}

/** The entity a plan points at, for the caller's reach check; undefined when there is no such plan. */
export function planEntity(id: number): { entity_type: string; entity_id: number } | undefined {
  return getDb().prepare("SELECT entity_type, entity_id FROM visit_plans WHERE id = ?").get(id) as
    | { entity_type: string; entity_id: number }
    | undefined;
}

/** `sets` are fixed `column = ?` fragments from the route. */
export function updatePlan(id: number, sets: string[], values: unknown[]): void {
  getDb().prepare(`UPDATE visit_plans SET ${sets.join(", ")} WHERE id = ?`).run(...(values as never[]), id);
}

export function deletePlan(id: number): void {
  getDb().prepare("DELETE FROM visit_plans WHERE id = ?").run(id);
}
