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

/** Human-readable straight-line distance in Persian. Switches to metres below a
 *  kilometre, where "0.4 کیلومتر" reads as false precision for a walk across a yard.
 *
 *  Callers are responsible for the "خط مستقیم" qualifier: this returns a bare
 *  magnitude, and a magnitude the reader mistakes for drive time is worse than no
 *  figure at all -- in Tehran the two differ by roughly a factor of two. */
export function formatDistanceKm(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} متر`;
  return `${km.toFixed(1)} کیلومتر`;
}

/** Total straight-line length of a day: origin -> each stop in order -> optionally back
 *  to the origin. Straight-line, so it is a comparison tool, never a promise about
 *  driving time -- what it is good for is ranking two orderings of the same stops, or
 *  two origins for the same day, where the systematic understatement cancels out. */
export function routeLengthKm(origin: LatLng, stops: LatLng[], returnToOrigin: boolean): number {
  if (stops.length === 0) return 0;

  let total = distanceKm(origin, stops[0]);
  for (let i = 1; i < stops.length; i++) total += distanceKm(stops[i - 1], stops[i]);
  if (returnToOrigin) total += distanceKm(stops[stops.length - 1], origin);
  return total;
}

/** 2-opt improvement pass over an existing stop order.
 *
 *  nearestNeighborOrder is greedy: it commits to the closest unvisited stop at every
 *  step and so reliably strands one far stop, leaving a route that visibly crosses
 *  itself. 2-opt repeatedly reverses the segment between two positions whenever doing
 *  so shortens the whole route, which is exactly the operation that removes a crossing.
 *
 *  It only ever accepts a strict improvement, so the result can never be longer than
 *  the input -- the property the planner's "shorter by N%" claim rests on.
 *
 *  O(n^2) per sweep and it sweeps until no improvement is found, which is free at the
 *  handful of stops a real delivery day has. MAX_SWEEPS is a guard against a pathological
 *  input oscillating on floating-point noise, not a quality knob. */
const MAX_SWEEPS = 50;

export function twoOptOrder<T extends LatLng>(stops: T[], origin: LatLng, returnToOrigin: boolean): T[] {
  if (stops.length < 2) return stops.slice();

  let best = stops.slice();
  let bestLength = routeLengthKm(origin, best, returnToOrigin);

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let improvedThisSweep = false;

    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const candidateLength = routeLengthKm(origin, candidate, returnToOrigin);
        // Strictly shorter, by more than floating-point noise: an equal-length swap is
        // churn, and accepting one lets the sweep loop oscillate forever.
        if (candidateLength < bestLength - 1e-9) {
          best = candidate;
          bestLength = candidateLength;
          improvedThisSweep = true;
        }
      }
    }

    if (!improvedThisSweep) break;
  }

  return best;
}
