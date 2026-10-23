import { NextRequest, NextResponse } from "next/server";
import { requireRole, canReachGroup } from "@/lib/session";
import { DeliveryError } from "@/lib/delivery";
import { findDeletableRun, removeRun } from "@/lib/repo/salesWrites";
import { MANAGE_ROLES } from "@/lib/roles";

/* A function, not a module-level response: a Response body can be read once, so the second request
   to reach this answer got an empty body. */
const notFound = () => NextResponse.json({ ok: false, error: "پیدا نشد" }, { status: 404 });

/** Removes an open route.
 *
 *  This is what the undo on «مسیر ساخته شد» calls, and what the delete button on each open
 *  column calls — so it has to refuse loudly rather than half-succeed: a run with anything
 *  delivered on it is a record, not a plan, and deleteRun says so in Persian instead of
 *  letting the caller find out by reloading.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const runId = Number((await ctx.params).id);

  /* 404 for a row outside the caller's territory, exactly as everywhere else — a 403 would
     confirm the run exists. Scoping BEFORE the delete is what stops one group's manager from
     removing another's route.
     The read lives in lib/repo/deliveries.ts so this handler holds no SQL; the repo-boundary
     test asserts raw SQL appears only under lib/repo/, and that test has a second case proving
     the grandfather allowlist may only shrink — so moving the query is the fix, never the list. */
  const run = await findDeletableRun(guard.session.organizationId, runId);
  if (!run || !await canReachGroup(guard.session, run.group_id)) return notFound();

  try {
    const { releasedOrderIds } = await removeRun(runId);
    /* Everything an undo needs to rebuild the route as it was: same driver, same day, and
       every order it was carrying. Without this the toast could only say "deleted", and an
       undo button would have been a promise the server could not keep. */
    return NextResponse.json({
      ok: true,
      id: runId,
      driver_user_id: run.driver_user_id,
      run_date: run.run_date,
      released_order_ids: releasedOrderIds,
    });
  } catch (e) {
    if (e instanceof DeliveryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    throw e;
  }
}