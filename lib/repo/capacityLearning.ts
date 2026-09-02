/** Learned capacity factors, folded from completed routes.
 *
 *  Phase 6 shipped measured defaults per weather condition. This nudges the tenant's
 *  own `capacity_factors` rows toward what its routes actually did — an observed factor
 *  per completed run, EWMA-folded into the `learned_*` columns. `resolvedCapacityFactorsFor`
 *  swaps in the learned value once there are `MIN_LEARN_N` observations behind it; below
 *  that the configured/shipped value stands. `lib/repo/weather.runWeatherAdjustment`
 *  reads the resolved set.
 */

import { getDb } from "@/lib/db";
import type { FactorRow } from "@/lib/weather/capacityAdjust";
import { observedFactor, ewmaUpdate } from "@/lib/predict/capacityLearning";

export const MIN_LEARN_N = 5;

const clampFactor = (n: number): number => Math.max(0.3, Math.min(1.3, n));

interface RunRow {
  id: number;
  weather_json: string | null;
  planned_duration_min: number | null;
  actual_duration_min: number | null;
  capacity_stops: number | null;
}

/** Fold every `done` run with weather + planned/actual timing into the tenant's
 *  `capacity_factors.learned_*` columns. Returns how many (run, condition) observations
 *  were applied. */
export function learnCapacityFromRuns(
  organizationId: number,
  asOfIso: string = new Date().toISOString()
): number {
  const db = getDb();
  const runs = db
    .prepare(
      `SELECT id, weather_json, planned_duration_min, actual_duration_min, capacity_stops
         FROM delivery_runs
        WHERE organization_id = ? AND status = 'done'
          AND weather_json IS NOT NULL
          AND planned_duration_min IS NOT NULL AND actual_duration_min IS NOT NULL
          AND run_date < ?`
    )
    .all(organizationId, asOfIso.slice(0, 10)) as unknown as RunRow[];

  let applied = 0;

  for (const run of runs) {
    let conditions: string[] = [];
    try {
      const parsed = JSON.parse(run.weather_json ?? "{}") as { conditions?: string[] };
      conditions = Array.isArray(parsed.conditions) ? parsed.conditions : [];
    } catch {
      conditions = [];
    }
    if (conditions.length === 0) continue;

    const speedObs =
      run.planned_duration_min && run.actual_duration_min
        ? observedFactor(run.actual_duration_min, run.planned_duration_min)
        : null; // planned/actual: ran long → < 1 → slower

    const actualStops = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) AS n FROM delivery_stops WHERE run_id = ? AND status = 'delivered'"
          )
          .get(run.id) as { n: number }
      ).n
    );
    const stopObs = run.capacity_stops ? observedFactor(run.capacity_stops, actualStops) : null;

    for (const code of conditions) {
      // Make sure a tenant row exists for this condition (seeded from the NULL-org default).
      let row = db
        .prepare(
          `SELECT id, learned_speed_factor, learned_stop_factor, learned_n
             FROM capacity_factors WHERE organization_id = ? AND condition_code = ?`
        )
        .get(organizationId, code) as
        | { id: number; learned_speed_factor: number | null; learned_stop_factor: number | null; learned_n: number }
        | undefined;

      if (!row) {
        const def = db
          .prepare(
            `SELECT stop_factor, service_time_factor, speed_factor, max_duration_factor, note_fa
               FROM capacity_factors WHERE organization_id IS NULL AND condition_code = ?`
          )
          .get(code) as FactorRow | undefined;
        const id = Number(
          db
            .prepare(
              `INSERT INTO capacity_factors
                 (organization_id, condition_code, stop_factor, service_time_factor, speed_factor,
                  max_duration_factor, note_fa, active, updated_at, learned_n)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0)`
            )
            .run(
              organizationId,
              code,
              def?.stop_factor ?? 1,
              def?.service_time_factor ?? 1,
              def?.speed_factor ?? 1,
              def?.max_duration_factor ?? 1,
              def?.note_fa ?? "خودآموز از مسیرهای واقعی",
              new Date().toISOString()
            ).lastInsertRowid
        );
        row = { id, learned_speed_factor: null, learned_stop_factor: null, learned_n: 0 };
      }

      const nextSpeed =
        speedObs != null ? clampFactor(ewmaUpdate(row.learned_speed_factor, speedObs)) : row.learned_speed_factor;
      const nextStop =
        stopObs != null ? clampFactor(ewmaUpdate(row.learned_stop_factor, stopObs)) : row.learned_stop_factor;

      db.prepare(
        `UPDATE capacity_factors
            SET learned_speed_factor = ?, learned_stop_factor = ?, learned_n = learned_n + 1, updated_at = ?
          WHERE id = ?`
      ).run(nextSpeed, nextStop, new Date().toISOString(), row.id);
      applied += 1;
    }
  }

  return applied;
}

/** Phase 6's `capacityFactorsFor` union, but each factor is the learned value once
 *  `learned_n >= MIN_LEARN_N`, else the configured one. */
export function resolvedCapacityFactorsFor(organizationId: number): FactorRow[] {
  const rows = getDb()
    .prepare(
      `SELECT condition_code, stop_factor, service_time_factor, speed_factor, max_duration_factor, note_fa,
              learned_stop_factor, learned_speed_factor, learned_service_time_factor, learned_max_duration_factor,
              learned_n, (organization_id IS NOT NULL) AS is_tenant
         FROM capacity_factors
        WHERE active = 1 AND (organization_id = ? OR organization_id IS NULL)`
    )
    .all(organizationId) as unknown as (FactorRow & {
    learned_stop_factor: number | null;
    learned_speed_factor: number | null;
    learned_service_time_factor: number | null;
    learned_max_duration_factor: number | null;
    learned_n: number;
    is_tenant: number;
  })[];

  const byCode = new Map<string, FactorRow>();
  for (const r of rows) {
    const existing = byCode.get(r.condition_code);
    if (existing && !r.is_tenant) continue;
    const trust = r.learned_n >= MIN_LEARN_N;
    byCode.set(r.condition_code, {
      condition_code: r.condition_code,
      stop_factor: trust ? r.learned_stop_factor ?? r.stop_factor : r.stop_factor,
      speed_factor: trust ? r.learned_speed_factor ?? r.speed_factor : r.speed_factor,
      service_time_factor: trust
        ? r.learned_service_time_factor ?? r.service_time_factor
        : r.service_time_factor,
      max_duration_factor: trust
        ? r.learned_max_duration_factor ?? r.max_duration_factor
        : r.max_duration_factor,
      note_fa: r.note_fa,
    });
  }
  return [...byCode.values()];
}
