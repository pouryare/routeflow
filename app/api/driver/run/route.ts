import { tehranTodayIso } from "@/lib/jalali";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { driverRunView } from "@/lib/repo/driverStops";

/** The run this driver is on.
 *
 *  Defaults to today's, falling back to their most recent -- a driver opening the app at
 *  00:30 after a late round should still see the round they are finishing, not an empty
 *  screen telling them they have no work.
 */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;

  const { run, runs } = driverRunView(guard.session.user.id, new URL(req.url).searchParams.get("run"), tehranTodayIso());
  if (runs.length === 0 || !run) return NextResponse.json({ ok: true, run: null });

  return NextResponse.json({ ok: true, run, runs });
}
