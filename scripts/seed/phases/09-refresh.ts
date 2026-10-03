/** Run the REAL refresh entry points so every rolled-up table is populated.
 *
 *  This phase is not "compute some numbers". `refreshAll` and `refreshPredictions` are the same
 *  functions the app calls; calling them is what makes /analytics, /sales/forecast and
 *  /dashboard agree with the underlying rows.
 *
 *  TWO SEPARATE ENTRY POINTS, and using only one is the failure the design warned about:
 *    - `refreshAll`          -> kpi_snapshots, margin, health
 *    - `refreshPredictions`  -> forecasts, churn, capacity
 *  `refreshAll` does NOT touch forecasts. Without this phase /sales/forecast stays empty even
 *  though the numbers are all sitting there.
 *
 *  Both are idempotent upserts, so this is safe to re-run.
 *
 *  CHURN: `trainChurnFromLapses` is a no-op below MIN_TRAIN_ROWS = 10 and needs 60-day
 *  lapses. Phase 05's lapsed cohort exists to feed it — which is why the silence there was
 *  worth fixing rather than working around.
 */

import { refreshAll } from "@/lib/repo/analysisRefresh";
import { refreshPredictions } from "@/lib/repo/predictionRefresh";
import type { SeedContext } from "../context";

export function run(ctx: SeedContext): void {
  const asOf = ctx.stamp(0);
  const analysis = refreshAll(ctx.orgId, asOf);
  const preds = refreshPredictions(ctx.orgId, asOf);

  ctx.progress(
    `analysis: ${analysis.written} roll-ups for ${analysis.period}/${analysis.prev_period}` +
      ` | predictions: ${preds.forecasts} forecasts, ${preds.churn} churn scores` +
      ` (trained: ${preds.churn_trained}), ${preds.capacity} capacity rows`,
  );
}
