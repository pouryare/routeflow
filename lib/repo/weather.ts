import { getDb } from "@/lib/db";
import type { LatLng } from "@/lib/geo";
import { fetchOpenMeteo, type WeatherSnapshotInput } from "@/lib/weather/openMeteo";
import {
  weatherAdjustment,
  neutralAdjustment,
  type FactorRow,
  type WeatherAdjustment,
} from "@/lib/weather/capacityAdjust";
import type { WeatherReading } from "@/lib/weather/conditions";

export interface SnapshotRow extends WeatherSnapshotInput {
  id: number;
  fetched_at: string;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The tenant's own capacity_factors unioned with the NULL-org defaults -- the tenant's
 *  row wins per condition_code. */
export function capacityFactorsFor(organizationId: number): FactorRow[] {
  const rows = getDb()
    .prepare(
      `SELECT condition_code, stop_factor, service_time_factor, speed_factor, max_duration_factor, note_fa,
              (organization_id IS NOT NULL) AS is_tenant
         FROM capacity_factors
        WHERE active = 1 AND (organization_id = ? OR organization_id IS NULL)`
    )
    .all(organizationId) as unknown as (FactorRow & { is_tenant: number })[];

  const byCode = new Map<string, FactorRow>();
  for (const r of rows) {
    const existing = byCode.get(r.condition_code);
    if (!existing || r.is_tenant) byCode.set(r.condition_code, r);
  }
  return [...byCode.values()];
}

export function snapshotFor(lat: number, lng: number, date: string): SnapshotRow | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM weather_snapshots WHERE lat_r = ? AND lng_r = ? AND forecast_date = ?"
    )
    .get(round2(lat), round2(lng), date) as SnapshotRow | undefined;
}

export function upsertSnapshot(row: WeatherSnapshotInput): void {
  getDb()
    .prepare(
      `INSERT INTO weather_snapshots
         (lat_r, lng_r, forecast_date, temp_min, temp_max, precip_prob, precip_mm, snow_mm,
          wind_kmh, gust_kmh, visibility_m, weather_code, fetched_at, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (lat_r, lng_r, forecast_date) DO UPDATE SET
         temp_min = excluded.temp_min, temp_max = excluded.temp_max,
         precip_prob = excluded.precip_prob, precip_mm = excluded.precip_mm,
         snow_mm = excluded.snow_mm, wind_kmh = excluded.wind_kmh, gust_kmh = excluded.gust_kmh,
         visibility_m = excluded.visibility_m, weather_code = excluded.weather_code,
         fetched_at = excluded.fetched_at, raw_json = excluded.raw_json`
    )
    .run(
      row.lat_r,
      row.lng_r,
      row.forecast_date,
      row.temp_min,
      row.temp_max,
      row.precip_prob,
      row.precip_mm,
      row.snow_mm,
      row.wind_kmh,
      row.gust_kmh,
      row.visibility_m,
      row.weather_code,
      new Date().toISOString(),
      row.raw_json
    );
}

/** Pull the forecast for a set of cells over a date range and store it. Glue path; a
 *  `null` response leaves whatever is already stored in place. Returns how many rows
 *  were written. */
export async function refreshForecast(points: LatLng[], dates: string[]): Promise<number> {
  const rows = await fetchOpenMeteo(points, dates).catch(() => null);
  if (!rows) return 0;
  for (const r of rows) upsertSnapshot(r);
  return rows.length;
}

/** The capacity adjustment for a cell + date from the stored snapshot. Neutral when
 *  there is no snapshot. */
export function runWeatherAdjustment(
  organizationId: number,
  opts: { lat: number; lng: number; date: string; vehicle_has_refrigeration?: boolean }
): WeatherAdjustment {
  const snap = snapshotFor(opts.lat, opts.lng, opts.date);
  if (!snap) return neutralAdjustment();
  const reading: WeatherReading = {
    temp_min: snap.temp_min,
    temp_max: snap.temp_max,
    precip_prob: snap.precip_prob,
    precip_mm: snap.precip_mm,
    snow_mm: snap.snow_mm,
    wind_kmh: snap.wind_kmh,
    gust_kmh: snap.gust_kmh,
    visibility_m: snap.visibility_m,
    weather_code: snap.weather_code,
  };
  return weatherAdjustment(reading, capacityFactorsFor(organizationId), {
    vehicle_has_refrigeration: opts.vehicle_has_refrigeration,
  });
}
