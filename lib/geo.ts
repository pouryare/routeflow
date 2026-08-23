import { faFixed, faNum } from "./format";
import { simplifyPath, type GeoJsonPosition } from "./simplify";

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
  if (km < 1) return `${faNum(Math.round(km * 1000))} متر`;
  return `${faFixed(km, 1)} کیلومتر`;
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

/** Shortest straight-line distance from a point to a *segment* (not the infinite line
 *  through it) in kilometres.
 *
 *  Backs two features that ask the same geometric question in different words: which
 *  leads and districts sit close to the corridor between two depots, and whether a day's
 *  route already passes near the warehouse between two consecutive stops.
 *
 *  Works in a local flat approximation: longitude degrees are scaled by cos(latitude) so
 *  they carry the same ground distance as latitude degrees, the projection is solved in
 *  that plane, and the resulting point is measured back with the real haversine. Over
 *  the tens of kilometres this is used across, the error is metres against distances
 *  measured in kilometres -- a projection library would buy nothing.
 *
 *  The clamp to [0, 1] is the whole reason this isn't a one-line perpendicular formula:
 *  without it, a point past either end of the segment measures to a spot on the
 *  extended line that nobody will ever drive past. */
export function distanceToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  const latScale = Math.cos(toRad((a.lat + b.lat) / 2));

  const ax = a.lng * latScale;
  const ay = a.lat;
  const bx = b.lng * latScale;
  const by = b.lat;
  const px = p.lng * latScale;
  const py = p.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;

  // Degenerate segment -- both endpoints are the same place.
  if (lengthSquared === 0) return distanceKm(p, a);

  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));

  return distanceKm(p, { lat: ay + t * dy, lng: (ax + t * dx) / latScale });
}

/** Shortest distance in kilometres from a point to anywhere on a path.
 *
 *  The corridor question -- "is this district near the run between the two depots" -- is
 *  asked against a road route, which is a polyline. Measured against the straight line
 *  between the endpoints instead, a district beside a motorway that bows north would
 *  read as tens of kilometres off a route it is actually on.
 *
 *  Infinity for an empty path, so a corridor that has not been computed puts everything
 *  outside it rather than inside it. */
export function distanceToPathKm(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return distanceKm(p, path[0]);

  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distanceToSegmentKm(p, path[i], path[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

/** Kilometres per degree of latitude, on the same sphere distanceKm measures with.
 *
 *  This was an ellipsoidal figure (110.574 km, which is the meridian degree at the
 *  *equator*, despite the comment claiming Tehran) while every distance the app reports
 *  is measured on a sphere of radius EARTH_RADIUS_KM. So the corridor band was drawn
 *  with one Earth and its contents decided with another, and its edge sat half a percent
 *  off the width it was asked for. Half a percent is 25 metres on a 5km band -- nothing
 *  you could see -- but there is no reason to keep two Earths, and deriving this from the
 *  radius above means they cannot drift apart again.
 *
 *  Longitude degrees shrink by cos(latitude), which is why that one is computed per-use
 *  rather than stored. */
const KM_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_KM) / 180;
const KM_PER_DEG_LNG_EQUATOR = KM_PER_DEG_LAT;

/** How far a mitred corner may run past the corner it turns, as a multiple of the band's
 *  half-width. Without a cap, a hairpin sends the corner off to infinity. */
const MITRE_LIMIT = 2;

/** A band of the given half-width running along `path`, as [lat, lng] pairs ready for a
 *  Leaflet polygon.
 *
 *  Drawn with square ends rather than rounded ones: a rounded cap would imply the
 *  corridor extends past the depots, and it does not -- it is the stretch of road
 *  actually driven between them.
 *
 *  ## Why the path is simplified first
 *
 *  Offsetting a polyline is only well behaved while the turns are gentle relative to the
 *  width. Road geometry is full of metre-scale jitter that is invisible inside a 5km band
 *  but whose offsets cross each other, and a self-crossing ring renders as a bowtie. So
 *  the path is flattened to a quarter of the half-width first -- detail the band could
 *  not show anyway. Genuine hairpins can still cross; the mitre cap bounds how badly.
 *
 *  ## Why this is only ever a drawing
 *
 *  Membership is decided by distanceToPathKm, never by a point-in-polygon test against
 *  this shape. The distance is exact and stays right through any bend; the polygon is an
 *  approximation whose whole job is to look like the answer.
 *
 *  Offsets are computed in a local km-space (longitude scaled by cos(latitude)) and
 *  converted back to degrees, so the band has the requested width on the ground rather
 *  than in raw degrees, which would render visibly lopsided at this latitude. */
export function corridorBandFromPath(path: LatLng[], halfWidthKm: number): [number, number][] {
  if (path.length < 2 || halfWidthKm <= 0) return [];

  const meanLat = path.reduce((sum, p) => sum + p.lat, 0) / path.length;
  const kmPerDegLng = KM_PER_DEG_LNG_EQUATOR * Math.cos(toRad(meanLat));
  if (kmPerDegLng === 0) return [];

  // Into km-space, dropping repeats so a duplicated vertex cannot produce a zero-length
  // segment with no direction to take a normal from.
  const pts: GeoJsonPosition[] = [];
  for (const p of path) {
    const q: GeoJsonPosition = [p.lng * kmPerDegLng, p.lat * KM_PER_DEG_LAT];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
  }

  const line = simplifyPath(pts, halfWidthKm / 4);
  if (line.length < 2) return [];

  // Left-hand unit normal of each segment.
  const normals: GeoJsonPosition[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const dx = line[i + 1][0] - line[i][0];
    const dy = line[i + 1][1] - line[i][1];
    const len = Math.hypot(dx, dy);
    normals.push([-dy / len, dx / len]);
  }

  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < line.length; i++) {
    // At the ends there is only one segment to take a side from; in between, the corner
    // is mitred along the bisector of the two.
    const before = normals[i - 1] ?? normals[i];
    const after = normals[i] ?? normals[i - 1];

    let mx = before[0] + after[0];
    let my = before[1] + after[1];
    const mLen = Math.hypot(mx, my);

    let reach = halfWidthKm;
    if (mLen === 0) {
      // The path doubles back on itself: there is no bisector, so square off the corner
      // against the outgoing segment instead of dividing by zero.
      mx = after[0];
      my = after[1];
    } else {
      mx /= mLen;
      my /= mLen;
      // |before + after| is 2cos(half the turn), so 2/|before + after| is the 1/cos that
      // restores the full width through the bend -- capped, or a hairpin spikes.
      reach = halfWidthKm * Math.min(2 / mLen, MITRE_LIMIT);
    }

    const [x, y] = line[i];
    left.push([(y + my * reach) / KM_PER_DEG_LAT, (x + mx * reach) / kmPerDegLng]);
    right.push([(y - my * reach) / KM_PER_DEG_LAT, (x - mx * reach) / kmPerDegLng]);
  }

  return [...left, ...right.reverse()];
}
