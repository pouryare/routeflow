// VROOM as a single-vehicle TSP solver.
//
// The existing ./vroom is an ASSIGNER: deliveries in, "which vehicle takes which" out.
// That is the wrong shape for ordering a day's stops, which are already assigned -- so this
// wraps one unbounded vehicle around them and reads the sequence back out. VROOM has no
// "just order these" endpoint, and this is the standard way to get one.
//
// Everything here is deliberately thin. The interesting decisions (which distance, which
// algorithm, what to tell the caller) live in ./orderStops, not here.

import { buildVroomJob, solveVroom } from "./vroom";
import { type LatLng } from "@/lib/geo";
import { straightLine, type DistanceFn } from "./distance";

export interface VroomOrderStop extends LatLng {
  id: number | string;
}

/** Unbounded on purpose: these stops are already one day's work, so any cap here would be a
 *  lie about work the caller has already committed to. VROOM wants integers. */
const NO_CAPACITY: [number, number, number] = [1_000_000, 1_000_000, 10_000];
const NO_SERVICE_MIN = 0;

/**
 * The stops in the order a solver would drive them, or null when no solver is configured or
 * it declined. `null` is a normal answer, not an error: VROOM_URL is unset in development,
 * so this returns null on every call there and the caller must have a fallback.
 */
export async function solveSingleVehicleOrder<T extends VroomOrderStop>(
  stops: T[],
  origin: LatLng,
  signal?: AbortSignal,
  distanceFn: DistanceFn = straightLine
): Promise<T[] | null> {
  if (!process.env.VROOM_URL) return null;

  // VROOM job ids are integers, so the caller's ids go through a position map and come back
  // the same way. A string id never entered the job; mapping by position means we never have
  // to guess what an id "meant".
  const deliveries = stops.map((s, i) => ({
    delivery_id: i + 1,
    lat: s.lat,
    lng: s.lng,
    weight_kg: 0,
    volume_m3: 0,
    service_min: NO_SERVICE_MIN,
  }));

  // The matrix VROOM needs is row/col 0 = depot, then one per stop, in order.
  const points = [origin, ...stops.map((s) => ({ lat: s.lat, lng: s.lng }))];
  const km: number[][] = points.map((a) => points.map((b) => distanceFn(a, b)));
  const durations = km.map((row) => row.map((d) => Math.round((d / 40) * 60)));

  const job = buildVroomJob(
    deliveries,
    [{ vehicle_key: 0, start: origin, end: origin, capacity: NO_CAPACITY }],
    { durations, distances: km }
  );

  const result = await solveVroom(job, signal);
  const first = result?.assignments[0];
  if (!first) return null;

  return first.stops
    .map((s) => stops[s.delivery_id - 1])
    .filter((s): s is T => s !== undefined);
}
