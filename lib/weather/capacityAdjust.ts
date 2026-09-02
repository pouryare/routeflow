/** Turn a forecast reading + the tenant's capacity_factors into a multiplicative
 *  adjustment ready for `lib/routing/capacity.effectiveCapacity`.
 *
 *  The cold chain is a HARD constraint, not a preference: above 35 C an unrefrigerated
 *  van has a maximum time before quality is at risk, so `extreme_heat` keeps its
 *  duration factor (default 0.70) unless the vehicle is refrigerated -- which lifts the
 *  duration factor to 1.0 while still taking the stop / service / speed hit of the heat.
 *
 *  Pure.
 */

import { conditionsFor, type ConditionCode, type WeatherReading } from "./conditions";
import type { CapacityFactor } from "@/lib/routing/capacity";

export interface FactorRow {
  condition_code: string;
  stop_factor: number;
  service_time_factor: number;
  speed_factor: number;
  max_duration_factor: number;
  note_fa?: string | null;
}

export interface WeatherAdjustment {
  conditions: ConditionCode[];
  factors: CapacityFactor[];
  cold_chain_capped: boolean;
  notes_fa: string[];
}

export function neutralAdjustment(): WeatherAdjustment {
  return { conditions: [], factors: [], cold_chain_capped: false, notes_fa: [] };
}

export function weatherAdjustment(
  w: WeatherReading,
  factorRows: FactorRow[],
  opts: { vehicle_has_refrigeration?: boolean } = {}
): WeatherAdjustment {
  const conditions = conditionsFor(w);
  const byCode = new Map(factorRows.map((r) => [r.condition_code, r]));
  const refrigerated = opts.vehicle_has_refrigeration === true;

  const factors: CapacityFactor[] = [];
  const notes_fa: string[] = [];
  let cold_chain_capped = false;

  for (const code of conditions) {
    const row = byCode.get(code);
    if (!row) {
      factors.push({});
      continue;
    }
    let duration = row.max_duration_factor;
    if (code === "extreme_heat") {
      if (refrigerated) {
        duration = 1;
      } else if (duration < 1) {
        cold_chain_capped = true;
      }
    }
    factors.push({
      stop: row.stop_factor,
      service: row.service_time_factor,
      speed: row.speed_factor,
      duration,
    });
    if (row.note_fa) notes_fa.push(row.note_fa);
  }

  return { conditions, factors, cold_chain_capped, notes_fa };
}
