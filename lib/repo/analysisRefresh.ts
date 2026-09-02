/** The analysis sweep entry point.
 *
 *  Kept in its own module because it wires together `kpiSnapshots`, `margin` and
 *  `health` — and `health` already imports `kpiSnapshots`, so putting the orchestrator
 *  in `kpiSnapshots` would close an import cycle. Same role as Phase 5's
 *  `runsNeedingFreeze` and Phase 7's `/api/rules/run`: a real scheduler or a boot
 *  check calls this; nothing here runs on a timer.
 */

import { currentPeriod, shiftPeriod } from "@/lib/analysis/period";
import { refreshSnapshots } from "./kpiSnapshots";
import { materialiseMargin } from "./margin";
import { materialiseHealth } from "./health";

export interface RefreshResult {
  period: string;
  prev_period: string;
  written: number;
}

/** Refresh the current and prior Jalali month's KPI snapshots, plus the margin and
 *  health roll-ups for the current month. Idempotent — every write is an upsert. */
export function refreshAll(organizationId: number, asOfIso: string = new Date().toISOString()): RefreshResult {
  const period = currentPeriod(asOfIso);
  const prev = shiftPeriod(period, 1);

  let written = 0;
  written += refreshSnapshots(organizationId, period).written;
  written += refreshSnapshots(organizationId, prev).written;
  // margin's org/group/salesperson trio overlaps refreshSnapshots by design (same
  // upsert key) — running it too keeps the detail path and the board in lock-step.
  written += materialiseMargin(organizationId, period);
  written += materialiseHealth(organizationId, period);

  return { period, prev_period: prev, written };
}
