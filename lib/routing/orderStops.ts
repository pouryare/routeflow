// The one way a day's stops get put in order.
//
// VROOM when it is configured, nearest-neighbour plus 2-opt when it is not -- and the
// caller is told which happened, because a day ordered by the fallback must not look like
// a day ordered by the solver. `VROOM_URL` is unset in development, so today every run
// takes the fallback path; silently, which is the problem.
//
// NOTE on what is NOT used here: `greedyAssign` from ./vroom. It takes vehicles with
// capacities and answers "which vehicle takes which delivery" -- a DIFFERENT question.
// `orderStops` is given stops already assigned to one day and answers "what order should
// this day be driven in". Using an assigner to order would mean inventing a vehicle per
// stop and reading back the sequence, which is a wrapper around nothing.

import { twoOptOrder } from "@/lib/geo";
import {
  straightLine,
  qualityOf,
  type DistanceFn,
  type DistanceQuality,
} from "./distance";
import type { LatLng } from "@/lib/geo";
import { solveSingleVehicleOrder } from "./vroomOrder";

export interface OrderableStop extends LatLng {
  id: number | string;
}

export type OrderQuality = "solver" | "fallback";

export interface OrderResult<T> {
  order: T[];
  /** Which algorithm ran. Not decoration -- see the note above. */
  quality: OrderQuality;
  /** Which measure it used. */
  distance: DistanceQuality;
}

export async function orderStops<T extends OrderableStop>(
  stops: T[],
  origin: LatLng,
  opts: { distanceFn?: DistanceFn; returnToOrigin?: boolean; signal?: AbortSignal } = {}
): Promise<OrderResult<T>> {
  const fn = opts.distanceFn ?? straightLine;
  const distance = qualityOf(fn);

  if (stops.length < 2) {
    return { order: stops.slice(), quality: "fallback", distance };
  }

  const solved = await solveSingleVehicleOrder(stops, origin, opts.signal, fn);
  if (solved && solved.length === stops.length) {
    return { order: solved as T[], quality: "solver", distance };
  }

  // Nearest-neighbour with 2-opt on the same shared distance. Not a lesser algorithm
  // pretending to be the solver -- it is the documented fallback, and `quality` says so.
  return {
    order: twoOptOrder(stops, origin, opts.returnToOrigin ?? false, fn),
    quality: "fallback",
    distance,
  };
}