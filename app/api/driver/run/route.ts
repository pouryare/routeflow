import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { readRun, readDriverRuns } from "@/lib/delivery";

/** The run this driver is on.
 *
 *  Defaults to today's, falling back to their most recent -- a driver opening the app at
 *  00:30 after a late round should still see the round they are finishing, not an empty
 *  screen telling them they have no work.
 */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;

  const db = getDb();
  const runs = readDriverRuns(db, guard.session.user.id);
  if (runs.length === 0) return NextResponse.json({ ok: true, run: null });

  const today = new Date().toISOString().slice(0, 10);
  const wanted =
    new URL(req.url).searchParams.get("run") ??
    String(runs.find((r) => r.run_date === today)?.id ?? runs[0].id);

  const run = readRun(db, Number(wanted));
  // Belt to the proxy's braces: the id can be typed into the URL, and a run belonging
  // to another driver must read as absent rather than as refused.
  if (!run || run.driver_user_id !== guard.session.user.id) {
    return NextResponse.json({ ok: true, run: null });
  }

  return NextResponse.json({ ok: true, run, runs });
}
