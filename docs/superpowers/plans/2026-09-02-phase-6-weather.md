# Phase 6 — Weather → capacity Implementation Plan

> Execute task-by-task, TDD, commit + push each. No review checkpoints.

**Goal:** Open-Meteo forecasts → `weather_snapshots`; the six conditions → tunable `capacity_factors` → a multiplicative adjustment feeding Phase 5's `effectiveCapacity`; forecast frozen into `delivery_runs.weather_json`; a planner weather band.

**Spec:** `docs/superpowers/specs/2026-09-02-phase-6-weather-design.md`

## Global Constraints

- Persian UI, English identifiers. Cross-tenant → 404. Migrations idempotent, guarded.
- Open-Meteo client = glue (env `OPEN_METEO_URL`, `null` on failure); `parseOpenMeteo` + the classifier + the factor composition are TDD'd.
- New DB access via `lib/repo/`. Never commit to `main`/build/restart.
- Vitest bg + poll. eslint `app/ lib/` + per-file. After route add: `npx next typegen && rm -rf .next/dev/types`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

### Task 1: `lib/weather/conditions.ts` — the six-condition classifier

**Files:** Create `lib/weather/conditions.ts`, `tests/weather-conditions.test.ts`.

- `WeatherReading`, `ConditionCode`, `conditionsFor(w)` per spec §2 triggers.
- Tests: `precip_mm 8` → `heavy_rain`; `precip_prob 80` → `heavy_rain`; `snow_mm 1` → `snow_ice`; `temp_min -2` + `precip_mm 1` → `snow_ice`; `temp_max 37` → `extreme_heat`; `gust_kmh 60` → `high_wind`; `weather_code 7` → `dust_storm`; `visibility_m 500` → `fog`; `weather_code 45` → `fog`; a mild reading → `[]`; a hot windy day → both codes.
- Pure. Commit.

### Task 2: `lib/weather/capacityAdjust.ts` — factor composition + cold chain

**Files:** Create `lib/weather/capacityAdjust.ts`, `tests/weather-capacity-adjust.test.ts`.

- `weatherAdjustment(w, factorRows, opts?)` → `{conditions, factors, cold_chain_capped, notes_fa}` per spec §3. Maps each condition to its `FactorRow`, emits `{stop,service,speed,duration}` for `effectiveCapacity`. A missing `FactorRow` for a condition → a neutral `{}` (defensive).
- Cold chain: `extreme_heat` present + not refrigerated → keep `max_duration_factor` (0.70), `cold_chain_capped: true`. Refrigerated → duration factor forced to 1.0, `cold_chain_capped: false`, stop/service/speed still applied.
- Tests: a `heavy_rain` row → one factor `{stop:0.8, service:1.2, speed:0.85, duration:1}`; `heavy_rain` + `high_wind` → two factors; `extreme_heat` unrefrigerated → `cold_chain_capped` true and `duration` 0.7; `extreme_heat` refrigerated → `cold_chain_capped` false and `duration` 1.0; feeding `factors` into `effectiveCapacity(base_stops:30)` for `snow_ice` → `max_stops` floored (17).
- Pure. Commit.

### Task 3: `lib/weather/openMeteo.ts` — `parseOpenMeteo` (pure) + `fetchOpenMeteo` (glue)

**Files:** Create `lib/weather/openMeteo.ts`, `tests/weather-openmeteo.test.ts`.

- `parseOpenMeteo(json, lat, lng)` → `WeatherSnapshotInput[]` (one per `daily.time[]` entry) mapping `temperature_2m_min/max`, `precipitation_probability_max`, `precipitation_sum`, `snowfall_sum`, `wind_speed_10m_max`, `wind_gusts_10m_max`, `weather_code`; `visibility` from hourly min if present else null. Returns `[]` on a malformed body.
- `fetchOpenMeteo(points, dates, signal?)` — glue, `OPEN_METEO_URL` env, `null` on failure. Builds `?latitude=&longitude=&daily=...&start_date=&end_date=`.
- Tests: `parseOpenMeteo` of a representative Open-Meteo daily payload yields rows with the right fields and dates; a body missing `daily` → `[]`.
- Commit.

### Task 4: schema — `weather_snapshots`, `capacity_factors`, seed

**Files:** Modify `lib/db.ts`, `tests/tenancy-schema.test.ts`; Create `tests/weather-schema.test.ts`.

- Two tables in the main schema block. `seedCapacityFactors(db)` (6 NULL-org rows, `INSERT … WHERE NOT EXISTS`) called next to `seedReasonCodes`. `TENANT_TABLES` += `capacity_factors`; exempt set += `weather_snapshots`. Both NULL→1 sweeps skip `capacity_factors`. `tenancy-schema` "leaves no row without an organisation" skips `capacity_factors`.
- Schema test: tables + uniques; `capacity_factors` has 6 NULL-org rows after boot; `weather_snapshots` UNIQUE `(lat_r,lng_r,forecast_date)`; a second identical snapshot upsert does not duplicate.
- Full suite — fix any tenancy-schema fallout.
- Commit.

### Task 5: `lib/repo/weather.ts`

**Files:** Create `lib/repo/weather.ts`, `tests/weather-repo.test.ts`.

- `capacityFactorsFor(orgId)` (tenant ∪ NULL-org, tenant wins per code), `snapshotFor`, `upsertSnapshot`, `refreshForecast` (glue call + upsert; no-op on null), `runWeatherAdjustment(orgId, {lat,lng,date,vehicle_has_refrigeration?})` → `WeatherAdjustment` (neutral when no snapshot).
- Tests: seed a `weather_snapshots` row (heavy rain) + call `runWeatherAdjustment` → `conditions` includes `heavy_rain`, factors present; a tenant `capacity_factors` override for `heavy_rain` (stop 0.5) wins over the default in the result; no snapshot → a neutral adjustment (`conditions: []`, `factors: []`); `upsertSnapshot` twice = one row, second values win.
- Commit.

### Task 6: wire into `buildPlan` / `commitPlan`

**Files:** Modify `lib/repo/routing.ts`, `tests/routing-repo.test.ts`.

- `buildPlan` — resolve `runWeatherAdjustment` for the group centroid (avg of the deliveries' lat/lng) + the plan date; `effectiveCapacity({base_stops: template?.max_stops ?? 40, ..., factors: adj.factors})` → `effective_max_stops`; each vehicle's stop capacity becomes `min(vehicle.max_stops ?? ∞, effective_max_stops)`. `plan.weather = { ...adj, effective_max_stops }`.
- `commitPlan` — `delivery_runs.weather_json = JSON.stringify(plan.weather)`, `capacity_stops = min(assignment.stops.length-cap, effective_max_stops)` (store the weather cap).
- Tests: seed a `snow_ice` snapshot at the deliveries' centroid; `buildPlan` returns `plan.weather.conditions` with `snow_ice` and `effective_max_stops` well below 40; `commitPlan` writes `weather_json` on the run and it round-trips.
- Commit.

### Task 7: API routes

**Files:** Create `app/api/sales/weather/route.ts`, `app/api/sales/weather/refresh/route.ts`, `app/api/sales/capacity-factors/route.ts`; Modify `proxy.ts`; Create `tests/api/weather-route.test.ts`.

- `GET /api/sales/weather?date=&lat=&lng=` → `{snapshot, adjustment}`. `POST /api/sales/weather/refresh` → `{written}` (no-op offline). `GET`/`PATCH /api/sales/capacity-factors`. owner/manager. proxy gate.
- `npx next typegen`.
- Tests: seed a snapshot, `GET /api/sales/weather` returns it + the adjustment; `PATCH /api/sales/capacity-factors` with `{condition_code:'fog', stop_factor:0.6}` then `GET` shows the tenant value; a salesperson → 403.
- Commit.

### Task 8: UI — planner weather band + driver line

**Files:** Modify `components/sales/RoutingPlanner.tsx`, `components/driver/DriverRun.tsx` (or the driver page).

- `RoutingPlanner` — a band above the run cards from `plan.weather`: per condition a chip + `note_fa`, «ظرفیت مؤثر: N از M توقف», and a red cold-chain line when `cold_chain_capped`.
- Driver page — one line from `delivery_runs.weather_json` (conditions + a cold-chain note).
- The map risk overlay is deferred (noted in handoff).
- `tsc` + `eslint` clean.
- Commit.

### Task 9: tenancy, real-data check, handoff

**Files:** Modify `tests/helpers/twoOrgs.ts`, `tests/tenancy-isolation.test.ts`, `docs/crm-erp-plan.md`; Create `tests/weather-migration-realdata.test.ts`, `docs/HANDOFF-2026-09-02-phase-6-weather.md`; update memory.

- `twoOrgs`: `OrgFixture` += `capacityFactorId`; seed a tenant `capacity_factors` (`heavy_rain`) + a `weather_snapshots` row.
- `tenancy-isolation`: tenant factor rows apart, NULL-org defaults shared, `weather_snapshots` org-blind.
- Real-data test per spec §9.
- Full suite, `tsc`, `eslint app/ lib/`. Plan doc row 6 → ✅ DONE. Handoff. Memory.
- Commit.
