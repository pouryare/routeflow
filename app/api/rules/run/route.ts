import { NextRequest } from "next/server";
import { sweepScope, sweepResponse } from "@/lib/sweepAuth";
import { runSweepRules, escalateStaleRuns, flushAllNotifications } from "@/lib/repo/rules";

export const dynamic = "force-dynamic";

/** The periodic rule sweep — a manager's «به‌روزرسانی» click (own org) or the cron
 *  with `x-sweep-token` (every org). Fires sweep rules, escalates stale runs, then
 *  flushes the feed rows both passes produced to push/telegram. The flush runs last and
 *  per org so an escalation's `task.escalated` notification goes out on the same tick. */
export async function POST(req: NextRequest) {
  const scope = sweepScope(req);
  if (!scope.ok) return scope.response;
  const results = [];
  for (const organization_id of scope.orgIds) {
    const fired = runSweepRules(organization_id).length;
    const escalated = escalateStaleRuns(organization_id);
    await flushAllNotifications(organization_id);
    results.push({ organization_id, fired, escalated });
  }
  return sweepResponse(scope.via, results);
}
