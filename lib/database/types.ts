/* Row and domain types shared across the app. They were declared in lib/db.ts, which made every
 * importer of a type depend on the 5,800-line module that also opens the database. lib/db.ts
 * still re-exports all of this (`export * from "./database/types"`), so no import site changes. */
import type { Role } from "../roles";
import type { CustomerLifecycle, CustomerType } from "../types";

export type CoverageStatus = "visited" | "needs_coverage" | "not_allowed" | "unknown";

export interface Customer {
  id: number;
  customer_code: string;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  lifecycle: CustomerLifecycle;
  customer_type: CustomerType | null;
  parent_customer_id: number | null;
  payment_terms_days: number;
  hard_credit_block: number;
  credit_limit_toman: number | null;
  qualified_at: string | null;
  first_order_at: string | null;
  salesperson: string | null;
  opening_balance_toman: number;
  notes: string | null;
  synced_at: string;
  last_purchase_date: string | null;
}

export interface District {
  id: number;
  name: string;
  level: "mantaghe" | "mahalle";
  parent_name: string | null;
  boundary_geojson: string;
  coverage_status: CoverageStatus;
  notes: string | null;
  is_custom: number;
  /** Short speakable code, NULL for a hand-drawn district with none assigned yet. */
  code: string | null;
  /** The منطقه number as an integer, 0 when the district names no number (a بخش or a town).
   *  An integer because the two source files spell the same district differently and
   *  UNIQUE(name, level, parent_name) joins on the name. */
  parent_no: number | null;
  updated_at: string;
  /** Which group holds this territory. NULL means unclaimed -- an owner sees it, no
   *  group manager does. Replaced the free-text assigned_to column, which is retained in
   *  the table only so history written against it stays readable. */
  group_id: number | null;
  /** Area-weighted centre, filled by backfillDistrictCentroids. NULL when the geometry
   *  could not produce one -- callers must treat that as "distance unknown", never 0. */
  centroid_lat: number | null;
  centroid_lng: number | null;
}

export type EntityType = "district" | "customer";

/** visit_plans alone accepts a facility: a restock stop at the warehouse is a genuine
 *  leg of the day's route, unlike a reminder or a photo, which are always attached to a
 *  district or a customer. Kept as its own union so widening the route model does not
 *  quietly loosen every other entity reference in the schema. */
export type PlanEntityType = EntityType | "facility" | "lead" | "lead_location";
/** What activity_log accepts. Same widening as PlanEntityType, for the same reason. */
export type LoggableEntityType = PlanEntityType | "product";
export const PLAN_ENTITY_TYPES: PlanEntityType[] = ["district", "customer", "facility", "lead", "lead_location"];

export interface ActivityEntry {
  id: number;
  entity_type: LoggableEntityType;
  entity_id: number;
  event_type: "status_change" | "note" | "assigned" | "created" | "updated";
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  changed_by: string | null;
  /** The acting user's id, so history survives a rename and two people with the same
   *  display name stay distinguishable. NULL on rows written before accounts existed. */
  changed_by_user_id: number | null;
  created_at: string;
}

export interface Reminder {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  due_date: string;
  message: string;
  resolved: number;
  created_at: string;
}

export interface Photo {
  id: number;
  entity_type: EntityType;
  entity_id: number;
  file_stem: string;
  caption: string | null;
  taken_at: string;
  created_at: string;
}

export interface VisitPlan {
  id: number;
  entity_type: PlanEntityType;
  entity_id: number;
  planned_date: string;
  status: "planned" | "done" | "skipped";
  sort_order: number;
  created_at: string;
}

export interface SaleRow {
  id: number;
  order_no: string | null;
  sale_date: string;
  customer_name: string;
  product_name: string | null;
  qty: number | null;
  amount: number;
  payment_status: string | null;
  shipping_status: string | null;
  imported_at: string;
}

export interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export interface ImportSnapshotRow {
  id: number;
  created_at: string;
  customers_json: string;
  sales_json: string;
}

/** Re-exported from roles.ts so server modules that already import from db.ts keep one
 *  import site, the same arrangement facilityTypes has at the top of this file. The
 *  definition itself has to live outside db.ts because client components need it and
 *  cannot import node:sqlite. */
export type { Role } from "../roles";
export { ROLES, ROLE_LABEL, ROLE_DESCRIPTION } from "../roles";

export interface GroupRow {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  active: number;
  created_at: string;
}

export interface OrganizationRow {
  id: number;
  name: string;
  slug: string;
  plan: string;
  active: number;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  display_name: string;
  role: Role;
  group_id: number | null;
  organization_id: number;
  staff_code: string | null;
  phone: string | null;
  active: number;
  token_version: number;
  location_consent_at: string | null;
  created_at: string;
  /** The route a person's face is served from, or null for initials. */
  avatar_url: string | null;
  /** The file stem behind that route. Separate from avatar_url so a `?key=` preset can be
   *  shown without losing the upload it is standing in for. */
  avatar_stem: string | null;
  /** 1 while the password is one an owner chose (a new account or a reset): the next sign-in
   *  must replace it before anything else (F35). */
  must_change_password: number;
}

export type LocationResolution = "direct" | "pluscode" | "browser" | "nominatim" | "manual" | "unresolved";
export type LocationStatus = "contacted" | "visited" | "no_answer" | "declined";
export const LOCATION_STATUSES: LocationStatus[] = ["contacted", "visited", "no_answer", "declined"];

export interface SavedLocationRow {
  id: number;
  name: string;
  maps_url: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  resolution: LocationResolution;
  notes: string | null;
  status: LocationStatus | null;
  rating_potential: number | null;
  rating_volume: number | null;
  rating_ease: number | null;
  group_id: number | null;
  organization_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface LeadListRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

/** A list plus its membership, in order. The API always returns them together: a list
 *  without its stops is never useful to a caller, and fetching them separately would
 *  make every page do two round trips to show one thing. */
export interface LeadListWithItems extends LeadListRow {
  location_ids: number[];
}
