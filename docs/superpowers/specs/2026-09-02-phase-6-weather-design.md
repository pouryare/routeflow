# RouteFlow Phase 6 — Weather → capacity — Design

**Date:** 2026-09-02 · **Branch:** `phase-6-weather` (off `phase-5-routing`) · **Status:** design.

Implements `docs/crm-erp-plan.md` §4.1: Open-Meteo forecasts, `weather_snapshots`, tunable `capacity_factors`, the six conditions turned into a multiplicative capacity adjustment that feeds Phase 5's `effectiveCapacity`, the forecast frozen into `delivery_runs.weather_json` at planning time, a planner band and a map risk overlay.

**Environment note.** Open-Meteo is a **keyless public API** — the client (`lib/weather/openMeteo.ts`) is glue but can actually be exercised in a live check, and it is written to degrade to `null` (then to the last stored snapshot) on any failure. The condition classifier, the factor composition and the cold-chain rule are pure and TDD'd.

---

## 1. Schema

```sql
CREATE TABLE weather_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lat_r REAL NOT NULL,          -- rounded to 2 dp -- one snapshot per ~1 km cell
  lng_r REAL NOT NULL,
  forecast_date TEXT NOT NULL,  -- 'YYYY-MM-DD'
  temp_min REAL, temp_max REAL,
  precip_prob INTEGER, precip_mm REAL, snow_mm REAL,
  wind_kmh REAL, gust_kmh REAL,
  visibility_m INTEGER, weather_code INTEGER,
  fetched_at TEXT NOT NULL,
  raw_json TEXT,
  UNIQUE (lat_r, lng_r, forecast_date)
);

CREATE TABLE capacity_factors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER REFERENCES organizations(id),   -- NULL = the shipped defaults
  condition_code TEXT NOT NULL,
  stop_factor REAL NOT NULL DEFAULT 1,
  service_time_factor REAL NOT NULL DEFAULT 1,
  speed_factor REAL NOT NULL DEFAULT 1,
  max_duration_factor REAL NOT NULL DEFAULT 1,
  note_fa TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE (organization_id, condition_code)
);
```

`weather_snapshots` → exempt (weather is not tenant data — a forecast for a lat/lng is the same for every company). `capacity_factors` → `TENANT_TABLES` (a tenant may tune its own; NULL-org rows are the shipped defaults, and the two NULL→1 backfill sweeps skip it exactly like `reason_codes`).

`seedCapacityFactors(db)` — the six conditions from §4.1, `organization_id NULL`, `INSERT … WHERE NOT EXISTS`:

| condition_code | stop | service | speed | max_duration | note_fa |
|---|---|---|---|---|---|
| `heavy_rain` | 0.80 | 1.20 | 0.85 | 1.00 | باران شدید — پارک و تحویل کندتر |
| `snow_ice` | 0.55 | 1.30 | 0.60 | 1.00 | برف و یخ‌بندان |
| `extreme_heat` | 0.85 | 1.15 | 1.00 | 0.70 | گرمای شدید — سقف زمان مسیر برای زنجیرهٔ سرد |
| `high_wind` | 0.85 | 1.10 | 0.90 | 1.00 | باد شدید |
| `dust_storm` | 0.70 | 1.10 | 0.70 | 1.00 | گرد و خاک — دید کم |
| `fog` | 0.80 | 1.05 | 0.75 | 1.00 | مه — دید کم |

---

## 2. Condition classifier — `lib/weather/conditions.ts` (pure, tested)

```ts
export interface WeatherReading {
  temp_min?: number | null; temp_max?: number | null;
  precip_prob?: number | null; precip_mm?: number | null; snow_mm?: number | null;
  wind_kmh?: number | null; gust_kmh?: number | null;
  visibility_m?: number | null; weather_code?: number | null;
}
export type ConditionCode =
  | "heavy_rain" | "snow_ice" | "extreme_heat" | "high_wind" | "dust_storm" | "fog";

/** Every condition whose trigger the reading meets. Order is not significant --
 *  factors compose multiplicatively. */
export function conditionsFor(w: WeatherReading): ConditionCode[];
```

Triggers (§4.1):
- `heavy_rain` — `precip_mm > 7` or `precip_prob > 70`
- `snow_ice` — `snow_mm > 0`, or `temp_min < 0` with any precipitation
- `extreme_heat` — `temp_max > 35`
- `high_wind` — `gust_kmh > 55`
- `dust_storm` — `weather_code` in the WMO dust/sand set `{6, 7, 8, 9, 30..35}`
- `fog` — `visibility_m < 1000`, or `weather_code` in `{45, 48}`

## 3. Factor composition — `lib/weather/capacityAdjust.ts` (pure, tested)

```ts
export interface FactorRow { condition_code: string; stop_factor: number; service_time_factor: number; speed_factor: number; max_duration_factor: number; }
export interface WeatherAdjustment {
  conditions: ConditionCode[];
  factors: CapacityFactor[];           // one per condition, in lib/routing/capacity shape
  cold_chain_capped: boolean;          // extreme_heat present AND the vehicle is unrefrigerated
  notes_fa: string[];
}
export function weatherAdjustment(
  w: WeatherReading,
  factorRows: FactorRow[],
  opts?: { vehicle_has_refrigeration?: boolean }
): WeatherAdjustment;
```

- Maps each `ConditionCode` to its `FactorRow` (a tenant's own row wins over the NULL-org default — the repo query does the union+dedupe; this function just consumes the resolved list).
- Returns `factors` as `{stop, service, speed, duration}` entries ready for `effectiveCapacity(input.factors)`.
- **Cold chain is a hard constraint, not a preference.** When `extreme_heat` applies and `vehicle_has_refrigeration` is not true, the `max_duration` factor is kept (0.70); when the vehicle *is* refrigerated, `extreme_heat`'s duration factor is lifted to 1.0 (the van is exempt) and `cold_chain_capped` is false. A refrigerated van still takes the stop/service/speed hit of the heat.

## 4. Repo — `lib/repo/weather.ts` (tested; the fetch is glue)

- `capacityFactorsFor(orgId)` — the tenant's rows unioned with the NULL-org defaults, tenant wins per `condition_code`.
- `snapshotFor(lat, lng, date)` — the row for the rounded cell, or undefined.
- `upsertSnapshot(row)` — `INSERT … ON CONFLICT (lat_r, lng_r, forecast_date) DO UPDATE`.
- `refreshForecast(points: LatLng[], dates: string[])` — calls `fetchOpenMeteo` (glue), upserts a snapshot per (cell, date); returns how many were written. On a `null` response it is a no-op (the last stored snapshot stands).
- `runWeatherAdjustment(orgId, { lat, lng, date, vehicle_has_refrigeration? })` → `WeatherAdjustment` from the stored snapshot (or a neutral adjustment when there is none).

`lib/weather/openMeteo.ts` (glue): `fetchOpenMeteo(points, dates, signal?)` → `WeatherSnapshotInput[] | null`. `OPEN_METEO_URL` env (default `https://api.open-meteo.com/v1/forecast`). `parseOpenMeteo(json)` — the daily→row mapping — is pure and tested.

---

## 5. Wiring into Phase 5

- **`buildPlan`** — before solving, for each delivery's cell (or the group's centroid) resolve `runWeatherAdjustment` for the plan date, compose its `factors` into `effectiveCapacity` against the template base to get `effective_max_stops`, and pass that as each vehicle's stop capacity (min with the vehicle's own). The proposal's `weather` block carries `{conditions, notes_fa, cold_chain_capped, effective_max_stops}`.
- **`commitPlan`** — write the resolved forecast + adjustment into `delivery_runs.weather_json` (**frozen at planning time**, never looked up afterward) and set `capacity_stops` to the weather-adjusted figure.
- **`RoutingPlan`** gains an optional `weather?: WeatherAdjustment & { effective_max_stops: number }`.

---

## 6. API

| route | method | notes |
|---|---|---|
| `/api/sales/weather` | GET `?date=&lat=&lng=` | the snapshot + the resolved adjustment for a cell/date |
| `/api/sales/weather/refresh` | POST `{dates?}` | refresh the forecast for the org's customer-cell set (glue; no-op offline) — owner/manager |
| `/api/sales/capacity-factors` | GET, PATCH | the tenant's tunable factors — owner/manager |

`proxy.ts`: fold `/api/sales/weather*` and `/api/sales/capacity-factors` into the routing gate (owner/manager).

---

## 7. UI

- **`/sales/routing`** — a weather band above the planner: per condition an icon-ish chip + `note_fa`, the effective stop count vs base, and a cold-chain warning line when `cold_chain_capped`. Sourced from the plan response's `weather` block.
- **Map layer** (`components/CoverageMap` / `HeatmapLayer` adjacent) — a toggle beside the basemap picker tinting districts by today's risk, reusing `--good/--warn/--crit`. Deferred to a follow-up if the map wiring is heavy; the band is the must-have. Noted in the handoff.
- **`/driver`** — one line at the top of the run: the conditions and a cold-chain note if the threshold is crossed (read from `delivery_runs.weather_json`).

---

## 8. Tenancy

`capacity_factors` on `TENANT_TABLES` (NULL-org defaults, sweeps skip it); `weather_snapshots` exempt. `twoOrgs` seeds one tenant-tuned `capacity_factors` row per org (`condition_code 'heavy_rain'`, colliding) + one `weather_snapshots` row (shared — no org). `tenancy-isolation`: the tenant factor rows stay apart, the NULL-org defaults are shared, `weather_snapshots` is org-blind.

---

## 9. Migration safety

`tests/weather-migration-realdata.test.ts` (env-gated): `foreign_key_check` empty; `weather_snapshots` + `capacity_factors` exist and (bar the seeded NULL-org defaults) empty; the seeded defaults number 6.

---

## 10. Deviations anticipated

- **Open-Meteo is keyless and reachable** — the client is still `null`-on-failure glue and `parseOpenMeteo` is the tested seam, but a live check can genuinely exercise it. No key, no account, no sanctions surface (same reasoning as OSM).
- **The map risk overlay may ship as a follow-up** — the planner weather band is the must-have; the district tint depends on how invasive the `CoverageMap` layer wiring is.
- **The learning loop is Phase 10** — Phase 6 ships `capacity_factors` as a hand-tuned table; replacing the constants with regressed values from a season of `delivery_runs.weather_json` + actuals is Phase 10's job.
- **One snapshot per 2-dp cell** (~1 km) — a whole territory usually resolves to a handful of cells; the planner uses the group centroid's cell unless a per-delivery lookup is cheap.
