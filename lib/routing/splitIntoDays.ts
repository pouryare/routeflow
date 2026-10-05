// One entry point for "split these stops into days", so no caller picks its own distance.
//
// `/leads` clusters geographically -- group nearby shops so a day is short. `?view=runs`
// splits by capacity -- fill days to a limit. Those stay two functions, because they answer
// different questions and forcing one on both would make one of them worse. What they share
// is the MECHANISM: every distance comes from lib/routing/distance.ts, and the default is
// chosen here rather than in each caller.
//
// The wrapper earns its place for one reason: an optional `distanceFn` with a silent
// straight-line fallback is what let six sites each hold their own opinion about how far two
// points are. Centralising the default means a caller can still pass a real road matrix, but
// cannot accidentally pick a different KIND of distance.

import { clusterIntoDays, daysNeeded, type DayCluster } from "@/lib/clusterDays";
import {
  straightLine,
  qualityOf,
  type DistanceFn,
  type DistanceQuality,
} from "./distance";
import type { LatLng } from "@/lib/geo";

export interface SplitInput<T> {
  /** How many stops a day should hold. Drives the day count as well as the per-day cap. */
  stopsPerDay: number;
  /** Where the day starts. Null means "no origin", and the clustering falls back to even. */
  origin: LatLng | null;
  /** The ONE distance. Omitted means the labelled straight line -- never a private default. */
  distanceFn?: DistanceFn;
  /** Priority stops, used to seed the days rather than compete for room. */
  seeds?: T[];
  /** Hard cap, when it differs from `stopsPerDay` (a vehicle's limit rather than a target). */
  maxPerDay?: number;
}

export interface SplitPlan<T> {
  days: DayCluster<T>[];
  /** Which measure produced these days. Shown, never assumed -- a plan laid out on straight
   *  lines in a city with a mountain pass through it is a different plan. */
  quality: DistanceQuality;
}

export function splitIntoDays<T extends LatLng>(stops: T[], input: SplitInput<T>): SplitPlan<T> {
  const fn = input.distanceFn ?? straightLine;
  const dayCount = input.stopsPerDay > 0 ? daysNeeded(stops.length, input.stopsPerDay) : 0;
  const days = clusterIntoDays(
    stops,
    dayCount,
    input.origin,
    fn,
    input.seeds,
    input.maxPerDay ?? (input.stopsPerDay > 0 ? input.stopsPerDay : undefined)
  );
  return { days, quality: qualityOf(fn) };
}