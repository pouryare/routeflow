/** Distance / duration matrices for the routing pipeline.
 *
 *  `haversineMatrix` is always available and is the fallback whenever the OSRM `/table`
 *  service is unreachable -- a straight-line matrix routes worse than road distances but
 *  still produces a usable stop order.
 *
 *  Pure -- the OSRM HTTP call lives in `osrmMatrix.ts`.
 */

import { distanceKm, type LatLng } from "@/lib/geo";

/** Symmetric km matrix; the diagonal is 0. */
export function haversineMatrix(points: LatLng[]): number[][] {
  const n = points.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distanceKm(points[i], points[j]);
      m[i][j] = d;
      m[j][i] = d;
    }
  }
  return m;
}

/** Seconds, at a flat city speed. VROOM wants integer seconds. */
export function durationMatrixFromKm(km: number[][], kmh = 22): number[][] {
  const perKmS = 3600 / kmh;
  return km.map((row) => row.map((d) => Math.round(d * perKmS)));
}
