/** Open-Meteo forecast client. Open-Meteo is keyless and public (same reasoning as
 *  OpenStreetMap: no key, no account, no sanctions surface), so `fetchOpenMeteo` can be
 *  genuinely exercised in a live check -- but it is still `null`-on-failure glue, and
 *  `parseOpenMeteo` (the daily -> row mapping) is the pure, tested seam.
 */

import { round2 } from "@/lib/math";
import type { LatLng } from "@/lib/geo";

const URL_BASE = process.env.OPEN_METEO_URL ?? "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 8000;

export interface WeatherSnapshotInput {
  lat_r: number;
  lng_r: number;
  forecast_date: string;
  temp_min: number | null;
  temp_max: number | null;
  precip_prob: number | null;
  precip_mm: number | null;
  snow_mm: number | null;
  wind_kmh: number | null;
  gust_kmh: number | null;
  visibility_m: number | null;
  weather_code: number | null;
  raw_json: string;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** One Open-Meteo `daily` payload (for a single lat/lng) -> one row per date. Returns []
 *  on anything malformed. */
export function parseOpenMeteo(json: unknown, lat: number, lng: number): WeatherSnapshotInput[] {
  if (typeof json !== "object" || json === null) return [];
  const b = json as {
    daily?: {
      time?: unknown;
      temperature_2m_min?: unknown;
      temperature_2m_max?: unknown;
      precipitation_probability_max?: unknown;
      precipitation_sum?: unknown;
      snowfall_sum?: unknown;
      wind_speed_10m_max?: unknown;
      wind_gusts_10m_max?: unknown;
      weather_code?: unknown;
      visibility_min?: unknown;
    };
  };
  const d = b.daily;
  if (!d || !Array.isArray(d.time) || d.time.length === 0) return [];
  const at = (a: unknown, i: number): number | null =>
    Array.isArray(a) ? num(a[i]) : null;

  const rows: WeatherSnapshotInput[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const date = d.time[i];
    if (typeof date !== "string") continue;
    rows.push({
      lat_r: round2(lat),
      lng_r: round2(lng),
      forecast_date: date,
      temp_min: at(d.temperature_2m_min, i),
      temp_max: at(d.temperature_2m_max, i),
      precip_prob: at(d.precipitation_probability_max, i),
      precip_mm: at(d.precipitation_sum, i),
      snow_mm: at(d.snowfall_sum, i),
      wind_kmh: at(d.wind_speed_10m_max, i),
      gust_kmh: at(d.wind_gusts_10m_max, i),
      visibility_m: at(d.visibility_min, i),
      weather_code: at(d.weather_code, i),
      raw_json: JSON.stringify({ date, i }),
    });
  }
  return rows;
}

/** Fetch a forecast for each point over a date range. Glue -- null on any failure. */
export async function fetchOpenMeteo(
  points: LatLng[],
  dates: string[],
  signal?: AbortSignal
): Promise<WeatherSnapshotInput[] | null> {
  if (points.length === 0 || dates.length === 0) return null;
  const start = dates.slice().sort()[0];
  const end = dates.slice().sort()[dates.length - 1];
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const daily =
    "temperature_2m_min,temperature_2m_max,precipitation_probability_max,precipitation_sum," +
    "snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,weather_code";

  try {
    const out: WeatherSnapshotInput[] = [];
    for (const p of points) {
      const u = `${URL_BASE}?latitude=${p.lat}&longitude=${p.lng}&daily=${daily}&timezone=auto&start_date=${start}&end_date=${end}`;
      const res = await fetch(u, { signal: combined });
      if (!res.ok) return null;
      out.push(...parseOpenMeteo(await res.json(), p.lat, p.lng));
    }
    return out;
  } catch {
    return null;
  }
}
