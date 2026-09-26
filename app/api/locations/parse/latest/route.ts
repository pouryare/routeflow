import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import * as importRepo from "@/lib/repo/leadImport";
import { plain } from "@/lib/db";
import { remainingByTier, currentMethod } from "@/lib/leadImport/scheduler";
import { estimateEtaSeconds } from "@/lib/leadImport/eta";

/** GET: the caller's most recent decode job, running or not.
 *
 *  This is what makes a refresh mid-import harmless: reopening /leads reattaches to the
 *  run already in progress rather than starting a second one or showing an empty box
 *  while work continues unseen. The decoding is server-side, so the browser tab was only
 *  ever watching -- losing it costs nothing but the watching. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const org = guard.session.organizationId;
  const job = importRepo.latestJob(org);
  if (!job) {
    return NextResponse.json({ ok: true, job: null, items: [], remaining: {}, currentMethod: null, etaSeconds: 0 });
  }

  const items = plain(importRepo.listItems(org, job.id));
  const pool = items
    .filter((i) => i.status === "pending" || i.status === "resolving")
    .map((i) => ({ id: i.id, ordinal: i.ordinal, resolution: i.resolution }));
  const remaining = remainingByTier(pool);
  const finished = items.filter((i) => i.status !== "pending" && i.status !== "resolving");

  return NextResponse.json({
    ok: true,
    job,
    items,
    remaining,
    currentMethod: currentMethod(pool),
    etaSeconds: estimateEtaSeconds({
      remaining,
      elapsedMs: Date.now() - new Date(job.created_at).getTime(),
      completed: finished.length,
    }),
  });
}
