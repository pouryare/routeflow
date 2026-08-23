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

export type CustomerColorMode = "status" | "debt" | "salesperson" | "inactivity";

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

// Categorical palette for the "salesperson" color mode -- deliberately outside the
// good/warn/crit/accent set (MASTER.md: those never carry non-semantic meaning).
const SALES_PALETTE = ["#5B8DEF", "#8B7CF6", "#E8749C", "#C9A227", "#4A9DA8", "#B0854A"];
export function salespersonColor(name: string | null, index: Map<string, number>): string {
  if (!name) return STATUS_COLOR.unknown;
  if (!index.has(name)) index.set(name, index.size);
  return SALES_PALETTE[index.get(name)! % SALES_PALETTE.length];
}
