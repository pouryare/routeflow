/** The six adverse-weather conditions from `docs/crm-erp-plan.md` §4.1, each with a
 *  measured effect on route capacity. This module only classifies a forecast reading;
 *  the effect lives in `capacity_factors` (tunable, later learned) and is applied by
 *  `lib/weather/capacityAdjust.ts`.
 *
 *  Pure -- no imports from `lib/db` / `lib/repo`.
 */

export interface WeatherReading {
  temp_min?: number | null;
  temp_max?: number | null;
  precip_prob?: number | null;
  precip_mm?: number | null;
  snow_mm?: number | null;
  wind_kmh?: number | null;
  gust_kmh?: number | null;
  visibility_m?: number | null;
  weather_code?: number | null;
}

export type ConditionCode =
  | "heavy_rain"
  | "snow_ice"
  | "extreme_heat"
  | "high_wind"
  | "dust_storm"
  | "fog";

export const CONDITION_CODES: ConditionCode[] = [
  "heavy_rain",
  "snow_ice",
  "extreme_heat",
  "high_wind",
  "dust_storm",
  "fog",
];

// WMO weather codes for dust/sand and for fog.
const DUST_CODES = new Set([6, 7, 8, 9, 30, 31, 32, 33, 34, 35]);
const FOG_CODES = new Set([45, 48]);

const n = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Every condition whose trigger this reading meets. Factors compose multiplicatively,
 *  so order does not matter. */
export function conditionsFor(w: WeatherReading): ConditionCode[] {
  const out: ConditionCode[] = [];
  const precipMm = n(w.precip_mm);
  const precipProb = n(w.precip_prob);
  const snowMm = n(w.snow_mm);
  const tempMin = n(w.temp_min);
  const tempMax = n(w.temp_max);
  const gust = n(w.gust_kmh);
  const vis = n(w.visibility_m);
  const code = n(w.weather_code);

  if ((precipMm != null && precipMm > 7) || (precipProb != null && precipProb > 70)) {
    out.push("heavy_rain");
  }
  const anyPrecip = (precipMm != null && precipMm > 0) || (snowMm != null && snowMm > 0);
  if ((snowMm != null && snowMm > 0) || (tempMin != null && tempMin < 0 && anyPrecip)) {
    out.push("snow_ice");
  }
  if (tempMax != null && tempMax > 35) out.push("extreme_heat");
  if (gust != null && gust > 55) out.push("high_wind");
  if (code != null && DUST_CODES.has(code)) out.push("dust_storm");
  if ((vis != null && vis < 1000) || (code != null && FOG_CODES.has(code))) out.push("fog");

  return out;
}
