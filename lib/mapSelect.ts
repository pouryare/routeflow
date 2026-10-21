import { distanceKm, type LatLng } from "@/lib/geo";

/** Picking places on a map by what is near, instead of tapping pins one at a time. Pure helpers
 *  over `distanceKm`; the map decides what a "point" is and what to do with the ids. */
export interface MapPoint extends LatLng {
  id: number;
}

/** The `n` points closest to `origin`, nearest first. Ties keep list order. */
export function nearestN(points: MapPoint[], origin: LatLng, n: number): number[] {
  if (n <= 0) return [];
  return points
    .map((p, i) => ({ id: p.id, i, d: distanceKm(origin, p) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, n)
    .map((x) => x.id);
}

/** Every point within `km` of `centre` (inclusive), nearest first. */
export function withinRadius(points: MapPoint[], centre: LatLng, km: number): number[] {
  return points
    .map((p, i) => ({ id: p.id, i, d: distanceKm(centre, p) }))
    .filter((x) => x.d <= km)
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.id);
}

/** Add `id` to the set if it is absent, remove it if present. Returns a new set. */
export function toggle<T>(set: ReadonlySet<T>, id: T): Set<T> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The radii offered for the circle tool, in km. */
export const RADII_KM = [1, 3, 5, 10] as const;
export const NEAREST_COUNTS = [5, 10, 20] as const;
