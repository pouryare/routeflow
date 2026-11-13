import { drainEvents } from "@/lib/repo/events";
import { runSweepRules, escalateStaleRuns, flushAllNotifications } from "@/lib/repo/rules";
import { queueMorningDigests } from "@/lib/repo/morningDigest";
import { cancelStaleDrafts } from "@/lib/repo/staleDrafts";
import { retireSoldOut } from "@/lib/repo/sellOff";
import { returnLoans } from "@/lib/repo/handover";

/** One company's periodic sweep: the body of `/api/rules/run` (a manager's «به‌روزرسانی» click or the
 *  token caller) and of the worker's `rules.sweep` job, so both do the same work. Fires sweep rules,
 *  escalates stale runs, then flushes the feed rows both passes produced to push and Telegram. The
 *  flush runs last so an escalation's `task.escalated` notification goes out on the same tick. */
export async function sweepCompanyRules(organizationId: number) {
  // E2: reactions that failed, or were cut off by a restart, run again before the sweep rules.
  const redriven = await drainEvents(organizationId);
  const fired = (await runSweepRules(organizationId)).length;
  const escalated = await escalateStaleRuns(organizationId);
  // FB40: drafts untouched for two weeks are cancelled, each with a line on its timeline.
  const draftsCancelled = await cancelStaleDrafts(organizationId);
  // T13: customers lent for a number of days go back once the last day has passed.
  await returnLoans(organizationId);
  // D32: a «تصفیه» product with nothing left is switched off.
  const soldOut = await retireSoldOut(organizationId);
  // F16: the owner's morning digest rides the same flush, once a day from 07:00 Tehran.
  await queueMorningDigests(organizationId);
  await flushAllNotifications(organizationId);
  return { organization_id: organizationId, events_redriven: redriven, fired, escalated, drafts_cancelled: draftsCancelled, sold_out: soldOut };
}
