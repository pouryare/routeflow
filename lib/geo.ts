export interface LatLng {
  lat: number;
  lng: number;
}

// Mean Earth radius (km), the same figure @turf/distance used, so the numbers this
// returns are unchanged from the version that called into turf.
const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;

// Great-circle distance in kilometers, by the haversine formula. This used to delegate
// to @turf/distance, which meant shipping @turf/distance + @turf/helpers to the browser
// -- and through GeofenceWatcher and the "nearby customers" panel, onto the map's
// critical path -- for one trigonometric expression.
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
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
