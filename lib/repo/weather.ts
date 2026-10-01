import { getDb } from "@/lib/db";
import { groupFilter, type Session } from "@/lib/session";
import type { LatLng } from "@/lib/geo";
import { fetchOpenMeteo, type WeatherSnapshotInput } from "@/lib/weather/openMeteo";
import {
  weatherAdjustment,
  neutralAdjustment,
  type FactorRow,
  type WeatherAdjustment,
} from "@/lib/weather/capacityAdjust";
import type { WeatherReading } from "@/lib/weather/conditions";
import type { ForecastRow } from "@/lib/weather/calendarForecast";
import { resolvedCapacityFactorsFor } from "@/lib/repo/capacityLearning";

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

/** Every snapshot inside an inclusive ISO date range, for one calendar month.
 *
 *  Deliberately NOT filtered by coordinates. The grid shows the weather where the work is,
 *  and a month view that came back empty whenever the tenant's office sat more than a few
 *  kilometres from a stored grid point would be worse than showing one city's forecast — a
 *  driver reads "clear" the same way whoever measured it. Ranged dates are inclusive on
 *  both ends so the caller cannot silently drop the last day of Esfand.
 *
 *  Raw SQL lives here rather than in the schedule page, which is grandfathered on the
 *  allowlist; new SQL does not join it (tests/repo-boundary.test.ts). */
export function snapshotsInRange(fromIso: string, toIso: string): ForecastRow[] {
  return getDb()
    .prepare(
      `SELECT forecast_date, temp_min, temp_max, precip_prob, precip_mm, snow_mm,
              wind_kmh, gust_kmh, visibility_m, weather_code
         FROM weather_snapshots
        WHERE forecast_date >= ? AND forecast_date <= ?
        ORDER BY forecast_date`,
    )
    .all(fromIso, toIso) as unknown as ForecastRow[];
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

/** Set (or clear) a tenant's override for one condition. Upsert on
 *  (organization_id, condition_code). */
export function upsertCapacityFactor(
  organizationId: number,
  input: {
    condition_code: string;
    stop_factor: number;
    service_time_factor: number;
    speed_factor: number;
    max_duration_factor: number;
    note_fa?: string | null;
    active?: boolean;
  }
): void {
  getDb()
    .prepare(
      `INSERT INTO capacity_factors
         (organization_id, condition_code, stop_factor, service_time_factor, speed_factor,
          max_duration_factor, note_fa, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, condition_code) DO UPDATE SET
         stop_factor = excluded.stop_factor, service_time_factor = excluded.service_time_factor,
         speed_factor = excluded.speed_factor, max_duration_factor = excluded.max_duration_factor,
         note_fa = excluded.note_fa, active = excluded.active, updated_at = excluded.updated_at`
    )
    .run(
      organizationId,
      input.condition_code,
      input.stop_factor,
      input.service_time_factor,
      input.speed_factor,
      input.max_duration_factor,
      input.note_fa ?? null,
      input.active === false ? 0 : 1,
      new Date().toISOString()
    );
}

/** The distinct ~1 km customer cells this session can see. */
export function customerCellsFor(session: Session, limit = 60): LatLng[] {
  const gf = groupFilter(session);
  return getDb()
    .prepare(
      `SELECT DISTINCT ROUND(lat, 2) AS lat, ROUND(lng, 2) AS lng
         FROM customers WHERE lat IS NOT NULL AND lng IS NOT NULL${gf.sql} LIMIT ${limit}`
    )
    .all(...gf.params) as unknown as LatLng[];
}

/** Refresh the org's customer cells over the next few days. No-op offline. */
export async function refreshOrgForecast(session: Session, dates?: string[]): Promise<{ written: number; cells: number }> {
  const cells = customerCellsFor(session);
  const days =
    dates && dates.length > 0
      ? dates.map((d) => d.slice(0, 10))
      : [0, 1, 2].map((i) => new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10));
  const written = await refreshForecast(cells, days);
  return { written, cells: cells.length };
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
  // Phase 10: the resolved set folds in factors the tenant's own routes have learned
  // (once >= MIN_LEARN_N observations); with no learning yet it is identical to
  // capacityFactorsFor, so every Phase 6 reading is unchanged.
  return weatherAdjustment(reading, resolvedCapacityFactorsFor(organizationId), {
    vehicle_has_refrigeration: opts.vehicle_has_refrigeration,
  });
}
