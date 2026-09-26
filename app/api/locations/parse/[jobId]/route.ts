import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import * as importRepo from "@/lib/repo/leadImport";
import { plain } from "@/lib/db";
import { remainingByTier, currentMethod } from "@/lib/leadImport/scheduler";
import { estimateEtaSeconds } from "@/lib/leadImport/eta";
import { maybeNotifySlowJob } from "@/lib/repo/leadImportNotify";

/** How long a job may run before it is worth telling the user about. Below this the
 *  job is simply finished before anyone would have looked away from the panel, and a
 *  notification for every ordinary paste would stop meaning anything. */
const SLOW_JOB_MS = 60_000;

/** GET: the state of one decode job, polled once a second by the panel.
 *
 *  Carries the ETA and the outstanding-per-method counts so the client does not have to
 *  re-derive either, and so the sentence naming the current method is computed from the
 *  same numbers the runner ordered by. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/locations/parse/[jobId]">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const id = Number((await ctx.params).jobId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const org = guard.session.organizationId;
  const job = importRepo.getJob(org, id);
  if (!job) return NextResponse.json({ ok: false, error: "پردازش پیدا نشد" }, { status: 404 });

  const items = plain(importRepo.listItems(org, id));

  // The pool is only the pending rows: what is still outstanding, in paste order.
  const pool = items
    .filter((i) => i.status === "pending" || i.status === "resolving")
    .map((i) => ({ id: i.id, ordinal: i.ordinal, resolution: i.resolution }));
  const remaining = remainingByTier(pool);

  const finished = items.filter((i) => i.status !== "pending" && i.status !== "resolving");
  const elapsedMs = Date.now() - new Date(job.created_at).getTime();

  const etaSeconds = estimateEtaSeconds({
    remaining,
    elapsedMs,
    completed: finished.length,
  });

  // One notification per job however many tabs are polling: the repo's claim is a
  // single conditional UPDATE, so only the first caller wins.
  if (job.status === "running" && elapsedMs >= SLOW_JOB_MS) {
    maybeNotifySlowJob(org, id, job.total);
  }

  return NextResponse.json({
    ok: true,
    job,
    items,
    remaining,
    currentMethod: currentMethod(pool),
    etaSeconds,
  });
}
