import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import * as importRepo from "@/lib/repo/leadImport";
import { PIN_POOL_ROLES } from "@/lib/roles";

/** POST: take back the rows one import auto-added.
 *
 *  Backs the ten-second undo that follows a finished batch. It is a scoped delete over
 *  exactly the saved_locations rows this job recorded, and it skips any pin that has
 *  since been visited -- at that point the row is a record of a real visit, not a
 *  leftover of an import. */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/locations/parse/[jobId]/undo">
) {
  const guard = await requireRole(req, PIN_POOL_ROLES);
  if (!guard.ok) return guard.response;

  const idRaw = (await ctx.params).jobId;
  if (!isId(idRaw)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const id = Number(idRaw);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  }

  const org = guard.session.organizationId;
  const job = await importRepo.getJob(org, id);
  if (!job) return NextResponse.json({ ok: false, error: "پردازش پیدا نشد" }, { status: 404 });

  const removed = await importRepo.undoJob(org, id);
  return NextResponse.json({ ok: true, removed });
}
