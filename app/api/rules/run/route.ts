import { NextRequest } from "next/server";
import { sweepScope, sweepResponse } from "@/lib/sweepAuth";
import { runSweepRules, escalateStaleRuns } from "@/lib/repo/rules";

export const dynamic = "force-dynamic";

/** The periodic rule sweep — a manager's «به‌روزرسانی» click (own org) or the cron
 *  with `x-sweep-token` (every org). Fires sweep rules + escalates stale runs. */
export async function POST(req: NextRequest) {
  const scope = sweepScope(req);
  if (!scope.ok) return scope.response;
  const results = scope.orgIds.map((organization_id) => ({
    organization_id,
    fired: runSweepRules(organization_id).length,
    escalated: escalateStaleRuns(organization_id),
  }));
  return sweepResponse(scope.via, results);
}
