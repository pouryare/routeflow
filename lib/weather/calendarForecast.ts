import { conditionsFor, type ConditionCode, type WeatherReading } from "./conditions";
import type { IconName } from "@/components/meridian/icon-map";

/** A month of weather reduced to what a calendar cell can actually show.
 *
 *  The forecast is already fetched, classified and stored by `lib/weather/` — it has just
 *  never reached a calendar. This is the projection that connects them, kept pure so it can
 *  be tested with no network and no database: a snapshot row in, an icon per day out.
 *
 *  The one behaviour worth stating is that a CALM day maps to an empty array rather than to
 *  a missing key. Those are not the same fact: "we looked and it is clear" and "we never
 *  fetched" must not render identically, or a failed forecast would look like good weather. */

export interface ForecastRow extends WeatherReading {
  forecast_date: string;
}

/** Worst condition first — the order the cell picks its icon in. A day that is both wet and
 *  38°C shows the heat, because heat is what stops the van running, not the rain. */
const SEVERITY: readonly ConditionCode[] = [
  "extreme_heat",
  "dust_storm",
  "snow_ice",
  "high_wind",
  "heavy_rain",
  "fog",
];

/** Every condition maps to an icon that already exists in `ICONS`. A missing name here is a
 *  type error, not a blank cell at runtime — which is the point of typing it as IconName.
 *
 *  Three conditions share the `fog` glyph deliberately: this is a 40px calendar cell, and
 *  rain/dust/fog read as "visibility" far better as one cloud than as three near-identical
 *  marks. `tsc` cannot check that ICONS is exhaustive, so a test asserts against the real
 *  map instead. */
export const CONDITION_ICON: Record<ConditionCode, IconName> = {
  heavy_rain: "fog",
  snow_ice: "mountain",
  extreme_heat: "sun",
  high_wind: "radar",
  dust_storm: "fog",
  fog: "fog",
};

/** A calendar-usable `YYYY-MM-DD`.
 *
 *  A regex alone is not enough. `/^\d{4}-\d{2}-\d{2}$/` happily accepts 2026-13-45, which is
 *  a well-formed string and not a date — it would become a key no calendar cell ever looks
 *  up, so the day would silently render as "no forecast" while looking like a fetched day.
 *  Round-tripping through Date is the cheap honest check: 2026-02-30 rolls over and is
 *  rejected too. */
function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** `Record<isoDate, ConditionCode[]>` for a whole month. A row without a usable
 *  `forecast_date` is skipped rather than written under an `undefined` key. */
export function monthConditions(rows: readonly ForecastRow[]): Record<string, ConditionCode[]> {
  const out: Record<string, ConditionCode[]> = {};
  for (const r of rows) {
    if (!isIsoDate(r.forecast_date)) continue;
    out[r.forecast_date] = conditionsFor(r);
  }
  return out;
}

/** The one glyph a cell shows for a day, or `null` when the day is clear. */
export function dayIcon(conditions: readonly ConditionCode[]): IconName | null {
  for (const code of SEVERITY) {
    if (conditions.includes(code)) return CONDITION_ICON[code];
  }
  return null;
}