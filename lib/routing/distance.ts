// The ONE place in this app that answers "how far is this from that?".
//
// Why this module exists, in one sentence: six places used to be able to answer that
// question differently, and they did. `/leads` asked OSRM for a road matrix; `?view=runs`
// used `Math.hypot` over raw degrees -- not kilometres, not even haversine -- which sorted
// 314 real orders by a number that means nothing. Every one of those sites compiled, every
// one looked correct on review, and the two pages could disagree while sharing a button.
//
// So the rule is not "please pass a distance". It is that no function outside lib/routing
// may DECLARE one, and `tests/routing-single-core.test.ts` greps for exactly that. An
// optional `distanceFn` with a silent straight-line default is the mechanism that let six
// sites each hold their own opinion, so the mechanism is what is removed.

import { distanceKm, type LatLng } from "@/lib/geo";

/** Any distance measure. Real roads (an OSRM table) and straight lines are interchangeable
 *  here, which is what lets every routing test run with no network. */
export type DistanceFn = (a: LatLng, b: LatLng) => number;

/** Which kind of distance a number actually is. Shown, never assumed. */
export type DistanceQuality = "roads" | "straight-line";

export interface DistanceMatrix {
  /** km[i][j] */
  km: number[][];
  quality: DistanceQuality;
}

/** The labelled fallback.
 *
 *  Real, and correct for a driver with no signal. But it is a straight line, and Tehran's
 *  roads do not run that way -- so anything that displays one says so. A number that looks
 *  like kilometres and is not is the same class of lie as showing a precise twelve-week grid
 *  that is only half real. */
export const straightLine: DistanceFn = distanceKm;

export function qualityOf(fn: DistanceFn): DistanceQuality {
  return fn === straightLine ? "straight-line" : "roads";
}

/** Carried here rather than in `lib/routeOrder.ts`, which is being deleted: the question
 *  "is this number real?" belongs with the number, not with the ordering that consumed it. */
export function isApproximate(fn: DistanceFn): boolean {
  return fn === straightLine;
}

/** Build a DistanceFn from an OSRM table, in the ONE shape the app has: the table plus the
 *  points it was fetched for, in the same order.
 *
 *  A missing cell falls back to the straight line rather than throwing, and that is a
 *  deliberate choice, not an oversight. OSRM genuinely returns null for a pair it could not
 *  route between, and throwing would take the whole proposal down for one unreachable pair.
 *  The fallback is `straightLine`, never a zero: a zero would make two stops look adjacent,
 *  which is the failure this whole module exists to remove. */
export function fromMatrix(
  points: readonly LatLng[],
  km: readonly (readonly number[])[]
): DistanceFn {
  const index = new Map<string, number>();
  points.forEach((p, i) => index.set(`${p.lat},${p.lng}`, i));
  return (a, b) => {
    const ai = index.get(`${a.lat},${a.lng}`);
    const bi = index.get(`${b.lat},${b.lng}`);
    if (ai === undefined || bi === undefined) return distanceKm(a, b);
    const v = km[ai]?.[bi];
    return v === undefined || v === null || !Number.isFinite(v) ? distanceKm(a, b) : v;
  };
}