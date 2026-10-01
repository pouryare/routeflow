/** Air quality, from the sibling of the endpoint `lib/weather/openMeteo.ts` already calls.
 *
 *  Open-Meteo serves air quality at `air-quality-api.open-meteo.com` with the same
 *  coordinates, the same free tier and NO API KEY — verified live for Tehran (HTTP 200,
 *  hourly pm2_5 / pm10 / european_aqi). So this file is a second URL, not an integration.
 *
 *  THE ONE RULE IN THIS FILE: this is CAMS reanalysis — a MODEL, not a sensor reading. It
 *  will not match Tehran's official station figures, so the UI must label it
 *  «تخمین مدل» (model estimate) and must never say «شاخص رسمی». `AIR_BAND_LABEL_FA` exists so
 *  the wording is a single constant that cannot drift per call site, and a test asserts the
 *  word "تخمین" is present in all four.
 *
 *  Everything here is pure and parses a response body, so it is testable with no network.
 *  The `fetch` lives in `lib/repo/weather.ts` alongside the existing weather snapshot call,
 *  which keeps "call the provider" in one file rather than two.
 */

export type AirBand = "good" | "moderate" | "poor" | "very_poor";

export const AIR_BANDS: readonly AirBand[] = ["good", "moderate", "poor", "very_poor"];

/** Model estimate, in words. Never "official". */
export const AIR_BAND_LABEL_FA: Record<AirBand, string> = {
  good: "هوای خوب (تخمین)",
  moderate: "هوای متوسط (تخمین)",
  poor: "هوای ناسالم (تخمین)",
  very_poor: "هوای خیلی ناسالم (تخمین)",
};

export interface AirDay {
  /** Daily MEAN µg/m³, or null when the provider had nothing. */
  pm2_5: number | null;
  pm10: number | null;
  /** The worst single hour — kept only so the detail panel can say so, never for banding. */
  peak_pm2_5: number | null;
  aqi: number | null;
}

/** European AQI bands, on the index scale the provider itself returns.
 *
 *  The plan's table banded on a FLAT µg/m³ threshold (20/40/75) applied to the worse of
 *  pm2_5 and pm10. Measured against a live Tehran response that is wrong: the European AQI
 *  weights PM2.5 far more heavily than PM10, so 170 µg/m³ of PM10 — genuinely unpleasant —
 *  comes back as `european_aqi: 75`. A flat table called that "very poor" at 120 µg/m³,
 *  which would paint a great many ordinary days red.
 *
 *  So the bands are on the INDEX, which is the thing Open-Meteo already computes and the
 *  thing "how was the air" actually means. Breakpoints are the European Environment
 *  Agency's: Fair ≤40, Moderate ≤60, Poor ≤80, Very poor ≤100, above that extremely poor.
 *  "good" covers the index below Fair, which is where clean air sits. */
const AQI_THRESHOLDS: Array<[number, AirBand]> = [
  [40, "good"],
  [60, "moderate"],
  [80, "poor"],
  [100, "very_poor"],
  [Infinity, "very_poor"],
];

/** Concentration fallback, used only when the provider sent no index.
 *
 *  These are the European per-pollutant breakpoints for the two bands that matter here
 *  (µg/m³), and they are PER POLLUTANT on purpose — comparing 20 µg/m³ of PM2.5 against
 *  20 µg/m³ of PM10 with one number is the mistake the index avoids.
 *
 *  Only used to produce a band when `aqi` is null, so it never competes with the index. */
const PM25_FALLBACK: Array<[number, AirBand]> = [
  [20, "good"],
  [40, "moderate"],
  [75, "poor"],
  [Infinity, "very_poor"],
];
const PM10_FALLBACK: Array<[number, AirBand]> = [
  [30, "good"],
  [50, "moderate"],
  [100, "poor"],
  [Infinity, "very_poor"],
];

const ORDER: Record<AirBand, number> = { good: 0, moderate: 1, poor: 2, very_poor: 3 };

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const bandFor = (value: number, table: Array<[number, AirBand]>): AirBand =>
  table.find(([t]) => value <= t)![1];

export function dayAirBand(d: AirDay): AirBand {
  const aqi = num(d.aqi);
  if (aqi !== null) return AQI_THRESHOLDS.find(([t]) => aqi <= t)![1];

  // No index: fall back to concentration, and take the WORSE of the two pollutants rather
  // than their average — dust is a PM10 problem, and averaging a clean PM2.5 with a filthy
  // PM10 hides exactly the day a driver needed to know about.
  const p25 = num(d.pm2_5);
  const p10 = num(d.pm10);
  if (p25 === null && p10 === null) return "good";
  const worst: AirBand =
    p25 !== null && p10 !== null
      ? ORDER[bandFor(p25, PM25_FALLBACK)] >= ORDER[bandFor(p10, PM10_FALLBACK)]
        ? bandFor(p25, PM25_FALLBACK)
        : bandFor(p10, PM10_FALLBACK)
      : p25 !== null
        ? bandFor(p25, PM25_FALLBACK)
        : bandFor(p10!, PM10_FALLBACK);
  return worst;
}

/** ISO date -> day, from an Open-Meteo hourly air-quality response.
 *
 *  Accepts either the full provider body (`{ hourly: { time, pm2_5, … } }`) or the hourly
 *  block on its own (`{ time, pm2_5, … }`). The provider sends the first; the plan's own test
 *  passed the second, so its implementation returned null for every valid input and the
 *  suite could never have passed as written. Accepting both is one `??` and removes a trap
 *  for the next caller.
 *
 *  Returns `null` — not `{}` — when the response is not the shape it expects. An empty
 *  object is truthy and would read downstream as "we have air-quality data, and it is
 *  empty", which is a different and wrong claim. A day whose every pollutant is null is
 *  still returned: that day genuinely exists in the response and simply had no readings. */
export function parseAirQuality(json: unknown): Record<string, AirDay> | null {
  const root = json as { hourly?: Record<string, unknown> } | null;
  const h = root && typeof root === "object" && "hourly" in root ? root.hourly : (json as Record<string, unknown>);
  if (!h || typeof h !== "object" || !Array.isArray((h as Record<string, unknown>).time)) return null;
  const box = h as Record<string, unknown>;
  const times = box.time as unknown[];
  if (times.length === 0) return null;

  const pm25 = Array.isArray(box.pm2_5) ? (box.pm2_5 as unknown[]) : [];
  const pm10 = Array.isArray(box.pm10) ? (box.pm10 as unknown[]) : [];
  const aqi = Array.isArray(box.european_aqi) ? (box.european_aqi as unknown[]) : [];

  const byDay = new Map<string, { p25: number[]; p10: number[]; peak: number[]; a: number[] }>();
  times.forEach((t, i) => {
    if (typeof t !== "string" || t.length < 10) return;
    const day = t.slice(0, 10);
    const b = byDay.get(day) ?? { p25: [], p10: [], peak: [], a: [] };
    // `num` rather than `typeof`: the provider sends nulls for missing hours, and a stray
    // string would otherwise turn the daily mean into NaN — which then bands as nothing.
    const v25 = num(pm25[i]);
    const v10 = num(pm10[i]);
    const va = num(aqi[i]);
    if (v25 !== null) {
      b.p25.push(v25);
      b.peak.push(v25);
    }
    if (v10 !== null) b.p10.push(v10);
    if (va !== null) b.a.push(va);
    byDay.set(day, b);
  });

  const mean = (xs: number[]): number | null =>
    xs.length === 0 ? null : Math.round(xs.reduce((a, c) => a + c, 0) / xs.length);
  const out: Record<string, AirDay> = {};
  for (const [day, b] of byDay) {
    out[day] = {
      pm2_5: mean(b.p25),
      pm10: mean(b.p10),
      peak_pm2_5: b.peak.length === 0 ? null : Math.max(...b.peak),
      aqi: mean(b.a),
    };
  }
  return out;
}