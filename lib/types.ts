import { distanceKm, type LatLng } from "./geo";
export type CoverageStatus = "visited" | "needs_coverage" | "not_allowed" | "unknown";

// Mirrors the --good/--warn/--crit/--neutral tokens in MASTER.md. Duplicated as literal
// hex (not var()) because Leaflet writes these straight onto SVG/canvas paths, which
// can't reliably resolve custom properties across renderers.
export const STATUS_COLOR: Record<CoverageStatus, string> = {
  visited: "#3DDC84",
  needs_coverage: "#F5A623",
  not_allowed: "#F0475B",
  unknown: "#5B6B7C",
};

export const STATUS_LABEL: Record<CoverageStatus, string> = {
  visited: "بازدید شده",
  needs_coverage: "نیاز به پوشش",
  not_allowed: "اجازه ورود ندارم",
  unknown: "نامشخص",
};

export interface DistrictProperties {
  id: number;
  name: string;
  level: "mantaghe" | "mahalle";
  parent_name: string | null;
  coverage_status: CoverageStatus;
  notes: string | null;
  is_custom: boolean;
  updated_at: string;
  assigned_to: string | null;
  /** Which group holds this territory, NULL when unclaimed. Distinct from assigned_to,
   *  which is a free-text person name and means something else entirely. */
  group_id: number | null;
  centroid_lat: number | null;
  centroid_lng: number | null;
}

/** What GET /api/districts returns. Geometry is deliberately absent -- it is fetched
 *  once from the version-stamped /api/districts/geometry and cached indefinitely, then
 *  stitched back together client-side into DistrictFeature. See lib/districtGeometry.ts. */
export interface DistrictPropertiesResponse {
  version: string;
  districts: DistrictProperties[];
}

/** id -> geometry, the payload shape of /api/districts/geometry. */
export type DistrictGeometryMap = Record<string, GeoJSON.Geometry>;

export interface DistrictFeature {
  type: "Feature";
  id: number;
  geometry: GeoJSON.Geometry;
  properties: DistrictProperties;
}

export interface DistrictCollection {
  type: "FeatureCollection";
  features: DistrictFeature[];
}

export interface CustomerRow {
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
  status: string | null;
  salesperson: string | null;
  debt_0_7: number;
  debt_8_30: number;
  debt_30_plus: number;
  notes: string | null;
  synced_at: string;
  last_purchase_date: string | null;
}

export type CustomerColorMode = "status" | "debt" | "salesperson" | "inactivity" | "distance";

export const CUSTOMER_COLOR_MODES: CustomerColorMode[] = [
  "status",
  "debt",
  "salesperson",
  "inactivity",
  "distance",
];

/** Guards a colour mode arriving from outside the app -- a deep link, which anyone can
 *  hand-edit. An unrecognised value falls back to the default rather than colouring
 *  every marker `undefined`. */
export function isCustomerColorMode(v: unknown): v is CustomerColorMode {
  return typeof v === "string" && (CUSTOMER_COLOR_MODES as string[]).includes(v);
}

// Customer status text comes straight from the workbook ("مشتری فعال", "غیرفعال", ...)
// and doesn't share a vocabulary with CoverageStatus (district coverage), so it gets
// its own bucket -> token mapping instead of reusing STATUS_COLOR.
export function customerStatusColor(status: string | null): string {
  if (!status) return STATUS_COLOR.unknown;
  if (status.includes("غیرفعال")) return STATUS_COLOR.unknown;
  if (status.includes("فعال")) return STATUS_COLOR.visited;
  return STATUS_COLOR.needs_coverage;
}

export function debtColor(c: CustomerRow): string {
  if (c.debt_30_plus > 0) return STATUS_COLOR.not_allowed;
  if (c.debt_8_30 > 0) return STATUS_COLOR.needs_coverage;
  return STATUS_COLOR.visited;
}

// Days since last purchase, or null if the customer has never bought anything (no
// سفارش row in the فروش sheet under this exact business name). Takes a minimal
// duck-typed shape (not the full CustomerRow) so it works equally for the API's
// CustomerRow and the DB layer's own Customer interface without a cast.
export function daysSinceLastPurchase(c: { last_purchase_date: string | null }, now: Date = new Date()): number | null {
  if (!c.last_purchase_date) return null;
  const last = new Date(c.last_purchase_date);
  if (Number.isNaN(last.getTime())) return null;
  return Math.floor((now.getTime() - last.getTime()) / 86400000);
}

export function inactivityColor(c: CustomerRow, now: Date = new Date()): string {
  const days = daysSinceLastPurchase(c, now);
  if (days === null) return STATUS_COLOR.unknown;
  if (days <= 30) return STATUS_COLOR.visited;
  if (days <= 60) return STATUS_COLOR.needs_coverage;
  return STATUS_COLOR.not_allowed;
}

/** Marker shapes for the colour-blind-safe mode.
 *
 *  Status is carried by green/amber/red alone, which is the one hue triad that
 *  deuteranopia and protanopia collapse -- somewhere around 8% of men see two of those
 *  three as the same colour. The facility markers already solved this for our own sites
 *  by committing to silhouette first and colour second; this extends the same idea to
 *  customers.
 *
 *  Keyed off the colour rather than the status because four of the five colour modes
 *  (status, debt, inactivity, distance) map onto exactly this palette -- so one mapping
 *  covers all of them, and each keeps its own meaning for the shape. The salesperson
 *  mode has its own categorical palette and stays diamonds throughout: there can be more
 *  salespeople than there are distinguishable shapes, and a shape that has to be looked
 *  up in a legend is worse than no shape at all.
 *
 *  The assignment follows road signs, which is the one shape vocabulary everybody
 *  already has: triangle warns, square stops, circle is clear. */
export type MarkerShape = "circle" | "triangle" | "square" | "diamond";

export function shapeForColor(color: string): MarkerShape {
  if (color === STATUS_COLOR.visited) return "circle";
  if (color === STATUS_COLOR.needs_coverage) return "triangle";
  if (color === STATUS_COLOR.not_allowed) return "square";
  return "diamond";
}

// Categorical palette for the "salesperson" color mode -- deliberately outside the
// good/warn/crit/accent set (MASTER.md: those never carry non-semantic meaning).
const SALES_PALETTE = ["#5B8DEF", "#8B7CF6", "#E8749C", "#C9A227", "#4A9DA8", "#B0854A"];
export function salespersonColor(name: string | null, index: Map<string, number>): string {
  if (!name) return STATUS_COLOR.unknown;
  if (!index.has(name)) index.set(name, index.size);
  return SALES_PALETTE[index.get(name)! % SALES_PALETTE.length];
}

// Distance bands, in km from the default-origin site. Fixed rather than derived from
// quantiles of the current customer set: a colour that means "far" has to mean the same
// thing next week, and a quantile scale silently repaints the whole map every time a
// customer is added. Chosen against the real spread -- median 19km, max 24km from the
// Pardis home base -- so all three bands actually carry customers.
export const DISTANCE_NEAR_KM = 10;
export const DISTANCE_MID_KM = 20;

export const DISTANCE_BANDS: { color: string; label: string }[] = [
  { color: STATUS_COLOR.visited, label: `تا ${DISTANCE_NEAR_KM} کیلومتر` },
  { color: STATUS_COLOR.needs_coverage, label: `${DISTANCE_NEAR_KM} تا ${DISTANCE_MID_KM} کیلومتر` },
  { color: STATUS_COLOR.not_allowed, label: `بیش از ${DISTANCE_MID_KM} کیلومتر` },
  { color: STATUS_COLOR.unknown, label: "بدون مختصات" },
];

/** Colours a customer by how far it is from the site we dispatch from -- a cost
 *  reading, which is why it reuses the good/warn/crit tokens rather than introducing a
 *  second colour language on the same markers. Precedent: inactivityColor already maps
 *  those tokens onto a non-status quantity for the same reason.
 *
 *  Straight-line, like every distance in this app. Callers must label it as such.
 *
 *  An unknown distance is neutral, never green: a customer with no coordinates is not
 *  a cheap one, and colouring it as such is exactly the wrong nudge. */
export function distanceColor(c: { lat: number | null; lng: number | null }, origin: LatLng | null): string {
  if (!origin || c.lat === null || c.lng === null) return STATUS_COLOR.unknown;
  const km = distanceKm({ lat: c.lat, lng: c.lng }, origin);
  if (km <= DISTANCE_NEAR_KM) return STATUS_COLOR.visited;
  if (km <= DISTANCE_MID_KM) return STATUS_COLOR.needs_coverage;
  return STATUS_COLOR.not_allowed;
}
