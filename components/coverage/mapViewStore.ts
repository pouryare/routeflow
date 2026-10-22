import { DistrictProperties, CustomerRow } from "@/lib/types";
import { MapView } from "@/lib/deepLink";

export const VIEW_KEY = "coverage_view";

/** Where this browser was left. A driver works one district for days at a time, and the
 *  map used to re-fit to every customer in the province on each load. */
export function readStoredView(): MapView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<MapView>;
    if (typeof v.lat !== "number" || typeof v.lng !== "number" || typeof v.zoom !== "number") return null;
    return { lat: v.lat, lng: v.lng, zoom: v.zoom };
  } catch {
    // Unparseable or storage blocked -- fall back to fitting, which is the old behaviour.
    return null;
  }
}

/** The opening view implied by a link that names a target but no position.
 *
 *  Computing it here, before the map is constructed, is what lets `?c=42` open *on* the
 *  customer instead of drawing Tehran and then flying away from it. Districts use the
 *  centroid already carried on their properties row, so this works before any polygon
 *  geometry has been fetched.
 *
 *  Zoom levels: 15 puts a shop in its street, 13 fits a neighbourhood. */
export function linkTargetView(
  link: { customerId?: number; districtId?: number },
  customers: CustomerRow[],
  districts: DistrictProperties[]
): MapView | null {
  if (link.customerId !== undefined) {
    const c = customers.find((x) => x.id === link.customerId);
    if (c && c.lat !== null && c.lng !== null) return { lat: c.lat, lng: c.lng, zoom: 15 };
  }
  if (link.districtId !== undefined) {
    const d = districts.find((x) => x.id === link.districtId);
    if (d && d.centroid_lat !== null && d.centroid_lng !== null) {
      return { lat: d.centroid_lat, lng: d.centroid_lng, zoom: 13 };
    }
  }
  return null;
}

export function writeStoredView(v: MapView): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    // Private mode. The map still works, it just won't remember.
  }
}
