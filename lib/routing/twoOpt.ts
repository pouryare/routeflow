// The fallback ordering: nearest-neighbour, then 2-opt sweeps until nothing improves.
//
// Moved out of lib/geo.ts so that lib/geo.ts declares no distance function of its own. It
// was not dead -- four call sites used it -- but it took an optional `distanceFn` with a
// silent haversine fallback, which is precisely the mechanism that let six sites each hold
// their own opinion about how far two points are.
//
// Every caller now goes through lib/routing/orderStops, which chooses the algorithm and
// reports which one ran. This function is the "no solver configured" branch of that choice,
// and it still accepts a distance because orderStops passes one.

import { type LatLng } from "@/lib/geo";
import { routeLength, straightLine, type DistanceFn } from "./distance";

const MAX_SWEEPS = 50;

export function twoOptOrder<T extends LatLng>(stops: T[], origin: LatLng, returnToOrigin: boolean, distanceFn?: DistanceFn): T[] {
  if (stops.length < 2) return stops.slice();

  // Use custom distance function (e.g., OSRM road distances) when provided,
  // otherwise fall back to haversine straight-line.
  const dist = distanceFn
    ? (a: LatLng, b: LatLng) => distanceFn(a, b)
    : straightLine;

  let best = stops.slice();
  let bestLength = routeLength(dist, origin, best, returnToOrigin);

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let improvedThisSweep = false;

    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
        const candidateLength = routeLength(dist, origin, candidate, returnToOrigin);
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
