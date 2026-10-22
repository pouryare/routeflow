/** The driver's home screen reads: the day's run, the prospect run, and their own commission. */

import { getDb } from "@/lib/db";
import { readDriverRuns, readRun } from "@/lib/delivery";
import { readTodaysLeadRun } from "@/lib/repo/leadRuns";
import { driverStatementFor } from "@/lib/driverCommissionLedger";
import type { Session } from "@/lib/session";

export function driverHomeData(session: Session, today: string, period: { from: string; to: string }) {
  const db = getDb();
  /* Deliveries fall back to the most recent run rather than an empty screen: a driver opening this at
     00:30 after a late round is finishing yesterday's work. */
  const runs = readDriverRuns(db, session.user.id);
  const chosen = runs.find((r) => r.run_date === today) ?? runs[0];
  return {
    run: chosen ? readRun(db, chosen.id) : null,
    // The same authority /api/lead-runs calls, painted on the server alongside the deliveries.
    leadRun: readTodaysLeadRun(db, session.user.id, session.organizationId, today),
    commission: driverStatementFor(db, session.user.id, period),
  };
}
