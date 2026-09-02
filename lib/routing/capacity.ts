/** Route capacity, from `docs/crm-erp-plan.md` §4.1.
 *
 *  Factors compose multiplicatively and the stop count is FLOORED so a bad day reduces
 *  rather than cancels a route: `effective_max_stops = max(floor(base × Πf), ceil(base ×
 *  0.4))`. Phase 5 feeds this only the vehicle-limit ratio; Phase 6 plugs its six weather
 *  conditions into the same `factors` array.
 *
 *  Pure -- no imports from `lib/db` / `lib/repo`.
 */

export interface CapacityFactor {
  stop?: number;
  service?: number;
  speed?: number;
  duration?: number;
}

export interface CapacityInput {
  base_stops: number;
  base_service_min: number;
  base_duration_min: number;
  factors: CapacityFactor[];
}

export interface EffectiveCapacity {
  max_stops: number;
  service_min: number;
  max_duration_min: number;
  /** The composed speed factor, for a caller that wants to scale a travel-time estimate. */
  speed_factor: number;
}

const MIN_STOP_FRACTION = 0.4;

function product(factors: CapacityFactor[], key: keyof CapacityFactor): number {
  return factors.reduce((acc, f) => acc * (f[key] ?? 1), 1);
}

export function effectiveCapacity(input: CapacityInput): EffectiveCapacity {
  const stopF = product(input.factors, "stop");
  const serviceF = product(input.factors, "service");
  const durationF = product(input.factors, "duration");
  const speedF = product(input.factors, "speed");

  const floor = Math.ceil(input.base_stops * MIN_STOP_FRACTION);
  return {
    max_stops: Math.max(Math.floor(input.base_stops * stopF), floor),
    service_min: Math.round(input.base_service_min * serviceF),
    max_duration_min: Math.round(input.base_duration_min * durationF),
    speed_factor: speedF,
  };
}

export interface VehicleLimits {
  max_weight_kg?: number | null;
  max_volume_m3?: number | null;
  max_stops?: number | null;
}
export interface RouteLoad {
  total_kg: number;
  total_m3: number;
  stop_count: number;
}

/** The first limit the load breaches, or null if it fits. A null limit is "no limit". */
export function vehicleFit(vehicle: VehicleLimits, load: RouteLoad): "weight" | "volume" | "stops" | null {
  if (vehicle.max_weight_kg != null && load.total_kg > vehicle.max_weight_kg + 1e-6) return "weight";
  if (vehicle.max_volume_m3 != null && load.total_m3 > vehicle.max_volume_m3 + 1e-6) return "volume";
  if (vehicle.max_stops != null && load.stop_count > vehicle.max_stops) return "stops";
  return null;
}

/** A vehicle's own limits expressed as a factor against a base -- so `effectiveCapacity`
 *  can treat "this van holds 20 not 30 stops" the same way it treats weather. */
export function vehicleLimitFactor(baseStops: number, vehicleMaxStops?: number | null): CapacityFactor {
  if (!vehicleMaxStops || baseStops <= 0) return {};
  return { stop: Math.min(1, vehicleMaxStops / baseStops) };
}
