import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import * as importRepo from "@/lib/repo/leadImport";
import { MANAGE_ROLES } from "@/lib/roles";

/** POST: stop a running decode.
 *
 *  Cooperative, not a kill: the in-flight link is allowed to finish and anything already
 *  decoded is kept and offered, so cancelling never throws away work the user waited for.
 *  The runner checks for the flag between batches. */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/locations/parse/[jobId]/cancel">
) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const id = Number((await ctx.params).jobId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const org = guard.session.organizationId;
  const job = importRepo.getJob(org, id);
  if (!job) return NextResponse.json({ ok: false, error: "پردازش پیدا نشد" }, { status: 404 });

  importRepo.requestCancel(org, id);
  return NextResponse.json({ ok: true, status: "cancelled" });
}
