/** The VROOM optimisation pipeline.
 *
 *  `buildVroomJob` and `applyVroomSolution` are pure and tested; `solveVroom` is
 *  env-gated glue. `greedyAssign` is the pure fallback that runs whenever `solveVroom`
 *  returns null -- nearest-neighbour from each vehicle's start plus a 2-opt pass,
 *  capacity-checked, overflow to `unassigned`. The planner therefore works with zero
 *  services; it just proposes a rougher route and says so.
 */

import { distanceKm, nearestNeighborOrder, type LatLng } from "@/lib/geo";
import { twoOptOrder } from "./twoOpt";
import { vehicleFit } from "./capacity";

export interface RoutableDelivery {
  delivery_id: number;
  lat: number;
  lng: number;
  weight_kg: number;
  volume_m3: number;
  service_min: number;
  time_window?: [number, number]; // seconds from midnight
  priority?: number; // 0..100
  needs_refrigeration?: boolean;
}

export interface RoutableVehicle {
  vehicle_key: number;
  start: LatLng;
  end: LatLng;
  /** [kg, m³×100, stops] -- VROOM capacities are integers. */
  capacity: [number, number, number];
  max_duration_s?: number;
  has_refrigeration?: boolean;
}

export interface Assignment {
  vehicle_key: number;
  stops: { delivery_id: number; sort_order: number; eta_min: number }[];
  distance_km: number;
  duration_min: number;
}
export interface SolveResult {
  assignments: Assignment[];
  unassigned: number[];
}

interface VroomJob {
  id: number;
  location_index: number; // into the shared matrix -- 0 is the depot, i+1 is delivery i
  service?: number;
  amount: [number, number, number];
  priority?: number;
  time_windows?: [number, number][];
  skills?: number[];
}
interface VroomVehicle {
  id: number;
  start_index: number;
  end_index: number;
  capacity: [number, number, number];
  skills?: number[];
  max_travel_time?: number;
}
export interface VroomRequest {
  jobs: VroomJob[];
  vehicles: VroomVehicle[];
  matrices: { car: { durations: number[][]; distances?: number[][] } };
  options: { g: boolean };
}

const REFRIGERATED_SKILL = 1;

/** deliveries + vehicles + a matrix (row/col 0 = the depot, then one per delivery in the
 *  given order) -> a VROOM request. */
export function buildVroomJob(
  deliveries: RoutableDelivery[],
  vehicles: RoutableVehicle[],
  matrix: { durations: number[][]; distances?: number[][] }
): VroomRequest {
  const jobs: VroomJob[] = deliveries.map((d, i) => ({
    id: d.delivery_id,
    location_index: i + 1,
    service: Math.round(d.service_min * 60),
    amount: [Math.round(d.weight_kg), Math.round(d.volume_m3 * 100), 1],
    priority: d.priority ?? 0,
    time_windows: d.time_window ? [d.time_window] : undefined,
    skills: d.needs_refrigeration ? [REFRIGERATED_SKILL] : undefined,
  }));

  const vroomVehicles: VroomVehicle[] = vehicles.map((v) => ({
    id: v.vehicle_key,
    start_index: 0,
    end_index: 0,
    capacity: v.capacity,
    skills: v.has_refrigeration ? [REFRIGERATED_SKILL] : undefined,
    max_travel_time: v.max_duration_s,
  }));

  return {
    jobs,
    vehicles: vroomVehicles,
    matrices: { car: { durations: matrix.durations, distances: matrix.distances } },
    options: { g: true },
  };
}

interface VroomResponse {
  routes?: {
    vehicle: number;
    distance?: number;
    duration?: number;
    steps?: { type: string; job?: number; arrival?: number }[];
  }[];
  unassigned?: { id: number }[];
}

export function applyVroomSolution(response: VroomResponse): SolveResult {
  const assignments: Assignment[] = (response.routes ?? []).map((r) => {
    let order = 0;
    const stops = (r.steps ?? [])
      .filter((s) => s.type === "job" && typeof s.job === "number")
      .map((s) => ({
        delivery_id: s.job as number,
        sort_order: order++,
        eta_min: Math.round((s.arrival ?? 0) / 60),
      }));
    return {
      vehicle_key: r.vehicle,
      stops,
      distance_km: Math.round(((r.distance ?? 0) / 1000) * 10) / 10,
      duration_min: Math.round((r.duration ?? 0) / 60),
    };
  });
  return { assignments, unassigned: (response.unassigned ?? []).map((u) => u.id) };
}

/** The fallback: pack deliveries onto vehicles nearest-first from each start, 2-opt the
 *  order, respect capacity, overflow to `unassigned`. */
export function greedyAssign(
  deliveries: RoutableDelivery[],
  vehicles: RoutableVehicle[]
): SolveResult {
  const assignments: Assignment[] = [];
  const unassigned: number[] = [];
  let pool = [...deliveries];

  for (const v of vehicles) {
    if (pool.length === 0) break;
    const maxStops = v.capacity[2];
    const picked: RoutableDelivery[] = [];
    let kg = 0;
    let m3x100 = 0;

    // nearest-first from the depot
    const ordered = nearestNeighborOrder(
      pool.map((d) => ({ ...d, lat: d.lat, lng: d.lng })),
      v.start
    );
    const rest: RoutableDelivery[] = [];
    for (const d of ordered) {
      const fit = vehicleFit(
        { max_weight_kg: v.capacity[0], max_volume_m3: v.capacity[1] / 100, max_stops: maxStops },
        { total_kg: kg + d.weight_kg, total_m3: (m3x100 + d.volume_m3 * 100) / 100, stop_count: picked.length + 1 }
      );
      if (fit === null) {
        picked.push(d);
        kg += d.weight_kg;
        m3x100 += d.volume_m3 * 100;
      } else {
        rest.push(d);
      }
    }
    pool = rest;

    if (picked.length === 0) continue;
    const seq = twoOptOrder(
      picked.map((d) => ({ ...d, lat: d.lat, lng: d.lng })),
      v.start,
      true
    ) as RoutableDelivery[];

    let km = distanceKm(v.start, seq[0]);
    let etaMin = 0;
    const stops = seq.map((d, i) => {
      if (i > 0) km += distanceKm(seq[i - 1], d);
      etaMin += Math.round((distanceKm(i === 0 ? v.start : seq[i - 1], d) / 22) * 60) + d.service_min;
      return { delivery_id: d.delivery_id, sort_order: i, eta_min: etaMin };
    });
    km += distanceKm(seq[seq.length - 1], v.end);

    assignments.push({
      vehicle_key: v.vehicle_key,
      stops,
      distance_km: Math.round(km * 10) / 10,
      duration_min: etaMin + Math.round((distanceKm(seq[seq.length - 1], v.end) / 22) * 60),
    });
  }

  for (const d of pool) unassigned.push(d.delivery_id);
  return { assignments, unassigned };
}

/** VROOM solve. Glue -- env `VROOM_URL`, null on failure. Not unit-tested. */
export async function solveVroom(job: VroomRequest, signal?: AbortSignal): Promise<SolveResult | null> {
  const url = process.env.VROOM_URL;
  if (!url) return null;
  const timeout = AbortSignal.timeout(15_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
      signal: combined,
    });
    if (!res.ok) return null;
    return applyVroomSolution((await res.json()) as VroomResponse);
  } catch {
    return null;
  }
}
