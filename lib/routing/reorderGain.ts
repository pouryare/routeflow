// What re-ordering a day would save, for the "optimise" button's label.
//
// The planner (orders) and /leads (runs) both offer an explicit "put these stops in a better
// order" action and both want to say how much it buys before the click. They each worked that
// out by hand -- one with 2-opt, one with nearest-neighbour -- so the same day could advertise
// two different savings. This is the single answer, measured with the same 2-opt that
// `orderStops` falls back to, so the label describes what the button actually does.

import type { LatLng } from "@/lib/geo";
import { routeLength, type DistanceFn } from "./distance";
import { twoOptOrder } from "./twoOpt";

export interface ReorderGain<T> {
  /** The stops in the improved order. */
  improved: T[];
  /** Kilometres saved, in the units `fn` measures. Never negative. */
  savedKm: number;
  /** Saved distance as a percentage of the current length; 0 for a zero-length day. */
  savedPct: number;
}

export function reorderGain<T extends LatLng>(
  origin: LatLng,
  stops: T[],
  returnToOrigin: boolean,
  fn: DistanceFn
): ReorderGain<T> {
  const current = routeLength(fn, origin, stops, returnToOrigin);
  const improved = twoOptOrder(stops, origin, returnToOrigin, fn);
  const savedKm = Math.max(0, current - routeLength(fn, origin, improved, returnToOrigin));
  return { improved, savedKm, savedPct: current > 0 ? (savedKm / current) * 100 : 0 };
}
