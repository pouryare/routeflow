import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, canReachGroup } from "@/lib/session";
import { deleteRun, DeliveryError } from "@/lib/delivery";
import { MANAGE_ROLES } from "@/lib/roles";

const NOT_FOUND = NextResponse.json({ ok: false, error: "پیدا نشد" }, { status: 404 });

/** Removes an open route.
 *
 *  This is what the undo on «مسیر ساخته شد» calls, and what the delete button on each open
 *  column calls — so it has to refuse loudly rather than half-succeed: a run with anything
 *  delivered on it is a record, not a plan, and deleteRun says so in Persian instead of
 *  letting the caller find out by reloading.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const runId = Number((await ctx.params).id);
  const db = getDb();

  const run = db
    .prepare("SELECT id, group_id, driver_user_id, run_date FROM delivery_runs WHERE id = ?")
    .get(runId) as
    | { id: number; group_id: number | null; driver_user_id: number; run_date: string }
    | undefined;
  /* 404 for a row outside the caller's territory, exactly as everywhere else — a 403 would
     confirm the run exists. Scoping BEFORE the delete is what stops one group's manager from
     removing another's route. */
  if (!run || !canReachGroup(guard.session, run.group_id)) return NOT_FOUND;

  try {
    const { releasedOrderIds } = deleteRun(db, runId);
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