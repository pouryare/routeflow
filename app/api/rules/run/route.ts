import { NextRequest } from "next/server";
import { sweepScope, sweepResponse } from "@/lib/sweepAuth";
import { runSweepRules, escalateStaleRuns, flushAllNotifications } from "@/lib/repo/rules";
import { drainEvents } from "@/lib/repo/events";
import { queueMorningDigests } from "@/lib/repo/morningDigest";
import { cancelStaleDrafts } from "@/lib/repo/staleDrafts";
import { retireSoldOut } from "@/lib/repo/sellOff";

export const dynamic = "force-dynamic";

/** The periodic rule sweep — a manager's «به‌روزرسانی» click (own org) or the cron
 *  with `x-sweep-token` (every org). Fires sweep rules, escalates stale runs, then
 *  flushes the feed rows both passes produced to push/telegram. The flush runs last and
 *  per org so an escalation's `task.escalated` notification goes out on the same tick. */
export async function POST(req: NextRequest) {
  const scope = await sweepScope(req);
  if (!scope.ok) return scope.response;
  const results = [];
  for (const organization_id of scope.orgIds) {
    // E2: reactions that failed or were cut off by a restart run again before the sweep rules.
    const redriven = await drainEvents(organization_id);
    const fired = (await runSweepRules(organization_id)).length;
    const escalated = await escalateStaleRuns(organization_id);
    // FB40: drafts untouched for two weeks are cancelled, each with a line on its timeline.
    const draftsCancelled = await cancelStaleDrafts(organization_id);
    // D32: a «تصفیه» product with nothing left is switched off.
    const soldOut = await retireSoldOut(organization_id);
    // F16: the owner's morning digest rides the same flush, once a day from 07:00 Tehran.
    await queueMorningDigests(organization_id);
    await flushAllNotifications(organization_id);
    results.push({ organization_id, events_redriven: redriven, fired, escalated, drafts_cancelled: draftsCancelled, sold_out: soldOut });
  }
  return sweepResponse(scope.via, results);
}
