/** The planner page's plain data: the week's date labels, the shapes of a plan row and an origin, the saved
 *  return-to-origin toggle, and the status styling. No React, so the page file holds the screen only. */

import type { CustomerRow } from "@/lib/types";
import type { SavedLocationRow } from "@/lib/db";

export const WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

/** A saved lead as the "add to plan" search needs it. Coordinates stay nullable: a pasted
 *  link that never resolved is still a lead worth planning a visit to. */
export type LeadLocation = Pick<SavedLocationRow, "id" | "name" | "lat" | "lng" | "address">;

/** What the "add to plan" dropdown offers. Tagged rather than sniffed: a customer row has an
 *  `address` too, so testing for one cannot tell the two apart -- and did not, which listed
 *  every customer as a lead and added it to the plan as one. */
export type AddCandidate =
  | { kind: "customer"; customer: CustomerRow }
  | { kind: "lead"; lead: LeadLocation };

export interface PlanRow {
  id: number;
  entity_type: "district" | "customer" | "facility" | "lead_location";
  entity_id: number;
  planned_date: string;
  status: "planned" | "done" | "skipped";
  sort_order: number;
  label: string;
  lat: number | null;
  lng: number | null;
}

export function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function dayLabel(d: Date) {
  return `${WEEKDAYS[d.getDay()]}`;
}
export function dateLabel(d: Date) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// Where the day's distances are measured from. Until this existed the planner fell
// back to *the first stop in the list* whenever there was no GPS fix -- which is the
// normal case, since a day is planned the evening before, indoors. Every distance
// figure and the whole stop order were computed from an arbitrary point.
//
// Precedence, highest first: a per-day override the user picked, a live GPS fix, the
// site flagged as default origin, and only then the old first-stop behaviour (kept so
// a database with no sites at all still renders).
export type OriginSource = "override" | "gps" | "facility" | "first_stop";

export interface Origin {
  lat: number;
  lng: number;
  label: string;
  source: OriginSource;
}

// Persisted like coverage_precision and coverage_geofence_on. Not every day ends back
// at the depot, so this is a toggle rather than always-on -- but most do, hence the
// default.
export const RETURN_KEY = "coverage_return_to_origin";

export function readReturnToOrigin(): boolean {
  try {
    return localStorage.getItem(RETURN_KEY) !== "0";
  } catch {
    return true;
  }
}

export const STATUS_META: Record<PlanRow["status"], { label: string; color: string }> = {
  planned: { label: "برنامه‌ریزی‌شده", color: "var(--warn)" },
  done: { label: "انجام شد", color: "var(--good)" },
  skipped: { label: "رد شد", color: "var(--neutral)" },
};

/** Keyed by type as well as id: customer 5 and lead 5 are different rows. */
const planKey = (type: string, id: number) => `${type}:${id}`;

/** What the "add to plan" dropdown offers for a typed query: customers by name or code, leads by name,
 *  skipping what the day already holds. */
export function addCandidatesFor(query: string, customers: CustomerRow[], leads: LeadLocation[], dayPlans: PlanRow[]): AddCandidate[] {
  const q = query.trim();
  if (!q) return [];
  const already = new Set(dayPlans.map((p) => planKey(p.entity_type, p.entity_id)));
  const customerMatches = customers
    .filter((c) => !already.has(planKey("customer", c.id)) && (c.business_name.includes(q) || c.customer_code.includes(q)))
    .slice(0, 6)
    .map((customer): AddCandidate => ({ kind: "customer", customer }));
  const leadMatches = leads
    .filter((l) => !already.has(planKey("lead_location", l.id)) && l.name.includes(q))
    .slice(0, 6)
    .map((lead): AddCandidate => ({ kind: "lead", lead }));
  return [...customerMatches, ...leadMatches];
}

/** The pins on the pick map: every customer and saved lead place with a position that is not already in the
 *  day. Keys are the ones VisitPlanFlow uses ("c" customer, "l" lead place). */
export function pickCandidatesFor(customers: CustomerRow[], leads: LeadLocation[], dayPlans: PlanRow[]) {
  const already = new Set(dayPlans.map((p) => planKey(p.entity_type, p.entity_id)));
  return [
    ...customers
      .filter((c) => c.lat !== null && c.lng !== null && !already.has(planKey("customer", c.id)))
      .map((c) => ({ key: `c${c.id}`, name: c.business_name, lat: c.lat as number, lng: c.lng as number })),
    ...leads
      .filter((l) => l.lat !== null && l.lng !== null && !already.has(planKey("lead_location", l.id)))
      .map((l) => ({ key: `l${l.id}`, name: l.name, lat: l.lat as number, lng: l.lng as number })),
  ];
}
