# RouteFlow Phase 6 (Weather → capacity) — Handoff

**Date:** 2026-09-02 · **Branch:** `phase-6-weather` (off `phase-5-routing`) · **Status:** code-complete, unmerged.

Spec: `docs/superpowers/specs/2026-09-02-phase-6-weather-design.md` · Plan: `docs/superpowers/plans/2026-09-02-phase-6-weather.md` (9 tasks, done).

## What shipped

| Area | Detail |
|---|---|
| `lib/weather/conditions.ts` | `conditionsFor(reading)` → the §4.1 six: `heavy_rain` (`precip_mm>7` \|\| `precip_prob>70`), `snow_ice` (`snow_mm>0` \|\| freezing + wet), `extreme_heat` (`temp_max>35`), `high_wind` (`gust_kmh>55`), `dust_storm` (WMO dust codes), `fog` (`visibility_m<1000` \|\| codes 45/48). Pure. |
| `lib/weather/capacityAdjust.ts` | `weatherAdjustment(reading, factorRows, {vehicle_has_refrigeration?})` → `{conditions, factors (one CapacityFactor per condition), cold_chain_capped, notes_fa}`. **Cold chain is hard**: `extreme_heat` keeps its 0.70 duration factor for an unrefrigerated van (and sets `cold_chain_capped`); a refrigerated van has the duration factor lifted to 1.0 but still takes the stop/service/speed hit. Feeds `lib/routing/capacity.effectiveCapacity`. Pure. |
| `lib/weather/openMeteo.ts` | `parseOpenMeteo(json, lat, lng)` (pure, tested — daily payload → one `WeatherSnapshotInput` per date, rounded to the 2 dp cell) + `fetchOpenMeteo(points, dates, signal?)` (keyless glue, env `OPEN_METEO_URL`, `null` on failure). |
| Schema | `weather_snapshots` (one row per ~1 km cell/day, `UNIQUE (lat_r, lng_r, forecast_date)`, **exempt** — a forecast is not tenant data). `capacity_factors` (measured effect per condition; `organization_id NULL` = the shipped six from `seedCapacityFactors`; on `TENANT_TABLES`; both NULL→1 backfill sweeps and `tenancy-schema`'s "no NULL org" check skip it, exactly like `reason_codes`). |
| `lib/repo/weather.ts` | `capacityFactorsFor(orgId)` (tenant ∪ NULL-org, tenant wins per code), `snapshotFor`, `upsertSnapshot` (ON CONFLICT upsert), `refreshForecast` / `refreshOrgForecast` (glue call + upsert; no-op on `null`), `customerCellsFor(session)`, `upsertCapacityFactor`, `runWeatherAdjustment(orgId, {lat,lng,date,vehicle_has_refrigeration?})` → a `WeatherAdjustment` from the stored snapshot (neutral when none). |
| Wired into Phase 5 | `buildPlan` resolves `runWeatherAdjustment` at the delivery centroid for the plan date, composes its factors into `effectiveCapacity` against the template base, and caps each vehicle's stop capacity at the weather-adjusted figure. `plan.weather = { conditions, notes_fa, cold_chain_capped, effective_max_stops, base_stops }`. `commitPlan` freezes it into `delivery_runs.weather_json` (**never re-fetched**) and sets `capacity_stops` to the weather ceiling. |
| API | `GET /api/sales/weather?lat=&lng=&date=` (snapshot + adjustment), `POST /api/sales/weather/refresh` (pull the org's customer cells; `{written: 0}` offline), `GET`/`PATCH /api/sales/capacity-factors` (tenant tuning, upsert). `proxy.ts` gates the write paths to owner/manager. |
| UI | `RoutingPlanner` — a weather band above the run cards: per-condition notes, «ظرفیت مؤثر: N از M توقف», a red cold-chain line. `/driver` — one line from the run's frozen `weather_json` (notes + a cold-chain warning). |
| Tenancy | `twoOrgs` seeds a tenant `capacity_factors` override (`heavy_rain`) per org; `tenancy-isolation` asserts the tenant rows stay apart and the six NULL-org defaults are shared. |

Suite: 162 files / 1443 tests green (+1 skipped). `tsc` + `eslint app/ lib/` clean. Real-data check passed: FK check clean, the two tables present, `weather_snapshots` empty, exactly 6 NULL-org `capacity_factors`, 0 tenant rows.

## Deviations from the plan

- **The map risk overlay is deferred** — the planner weather band is the must-have and it shipped; a district tint on `CoverageMap` keyed to today's risk is a follow-up (the `HeatmapLayer` wiring is more invasive than the band was worth this pass). Noted for whoever picks up the map layers next.
- **Open-Meteo is keyless and genuinely reachable** — the client is still `null`-on-failure glue and `parseOpenMeteo` is the tested seam, but a live check can exercise it end to end. No key, no account (same reasoning as OSM).
- **The forecast is resolved at the group centroid**, not per delivery — a territory usually resolves to a handful of 2 dp cells and the centroid's cell is representative; a per-delivery lookup is a cheap change if it ever matters.
- **The learning loop is Phase 10** — `capacity_factors` ships hand-tuned; regressing the constants from a season of `delivery_runs.weather_json` + actual durations/failures is Phase 10.

## Pre-deploy checklist (after Phase 10, with the whole branch stack)

1. Fresh backup via the SQLite backup API.
2. `ROUTEFLOW_MIGRATION_CHECK_DB=<copy> npx vitest run tests/weather-migration-realdata …` — FK check empty, tables present, 6 NULL-org factor rows, 0 tenant rows.
3. `npm run build` + `systemctl restart coverage-map`.
4. Set `OPEN_METEO_URL` (or leave the default public host); `POST /api/sales/weather/refresh` once and confirm `written > 0`; build a plan for a day with adverse weather and confirm the band shows and `capacity_stops` on the committed run is below base.

## Next: Phase 7 — Spine + briefing

Per `docs/crm-erp-plan.md` §M8: `events` / `tasks` / `alerts` / `rule_runs` with cooldown + escalation, and `/today` role-branched for all six roles. This is almost pure logic — the rule engine (trigger → cooldown → escalate → task) and the briefing queries are fully TDD-able; there is no external service. Branch off `phase-6-weather`.
