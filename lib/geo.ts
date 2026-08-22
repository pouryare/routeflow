import distance from "@turf/distance";
import { point } from "@turf/helpers";

export interface LatLng {
  lat: number;
  lng: number;
}

// Great-circle distance in kilometers. Thin wrapper so call sites never touch
// GeoJSON point construction directly.
export function distanceKm(a: LatLng, b: LatLng): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: "kilometers" });
}

// Greedy nearest-neighbor ordering starting from `start` (or the first stop when
// no start is given). Adequate for the small per-day stop counts this app deals
// with -- not a TSP solver, just closest-unvisited-next.
export function nearestNeighborOrder<T extends LatLng>(stops: T[], start: LatLng | null): T[] {
  const remaining = stops.slice();
  const ordered: T[] = [];
  let cur = start;
  while (remaining.length) {
    let bestIdx = 0;
    if (cur) {
      let bestDist = Infinity;
      remaining.forEach((s, i) => {
        const d = distanceKm(cur as LatLng, s);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      });
    }
    const next = remaining.splice(bestIdx, 1)[0];
    ordered.push(next);
    cur = next;
  }
  return ordered;
}
