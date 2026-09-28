import { NextRequest, NextResponse } from "next/server";
import { getDb, plain } from "@/lib/db";
import { requireRole } from "@/lib/session";
import {
  LeadRunError,
  assignableDrivers,
  createOrReuseLeadRun,
  readScopedLeadRuns,
  readLeadRunAssignments,
  readTodaysLeadRun,
} from "@/lib/repo/leadRuns";
import { isVanRole } from "@/lib/roles";
import { MANAGE_ROLES } from "@/lib/roles";

/** A driver's day, or a manager's roster of them.
 *
 *  The split is the whole point of the table. A driver is not shown the pool: they get
 *  `today` -- their run for today, else the most recent unfinished one, for the same reason
 *  /driver falls back rather than showing an empty screen at 00:30 after a late round.
 *
 *  No `plain()` on a single run: readLeadRun already spreads the row into an ordinary object
 *  and builds its stops the same way, so there is no null-prototype value left to trip React
 *  on. It is only needed where a whole array of raw rows goes out, which is the roster below. */

const todayIso = () => new Date().toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "field_rep", "delivery_driver"]);
  if (!guard.ok) return guard.response;
  const db = getDb();
  const session = guard.session;
  const url = new URL(req.url);

  if (isVanRole(session.role)) {
    const run = readTodaysLeadRun(db, session.user.id, session.organizationId, todayIso());
    return NextResponse.json({ ok: true, run });
  }

  // The dropdown's options, so the manager does not have to know who the drivers are.
  if (url.searchParams.get("drivers") === "1") {
    return NextResponse.json({ ok: true, drivers: assignableDrivers(db, session) });
  }
  // The leads page's phone book: who currently holds which lead. A query branch rather than
  // its own route so the role check and the scoping live in one place, matching `drivers`.
  if (url.searchParams.get("assignments") === "1") {
    return NextResponse.json({ ok: true, assignments: readLeadRunAssignments(db, session) });
  }
  return NextResponse.json({ ok: true, runs: plain(readScopedLeadRuns(db, session)) });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    driver_user_id?: unknown;
    run_date?: unknown;
    location_ids?: unknown;
    notes?: unknown;
    override?: unknown;
  } | null;
  if (body?.driver_user_id == null) {
    return NextResponse.json({ ok: false, error: "راننده مشخص نشده است" }, { status: 400 });
  }
  if (!Array.isArray(body.location_ids)) {
    return NextResponse.json({ ok: false, error: "مسیر خالی است" }, { status: 400 });
  }

  try {
    const result = createOrReuseLeadRun(getDb(), guard.session, {
      driver_user_id: Number(body.driver_user_id),
      run_date: body.run_date,
      location_ids: (body.location_ids as unknown[]).map(Number),
      notes: typeof body.notes === "string" ? body.notes : null,
      // Only ever true from a UI that showed the manager this day is already finished.
      override: body.override === true,
    });
    return NextResponse.json({ ok: true, run: result.run, reused: result.reused }, { status: result.reused ? 200 : 201 });
  } catch (e) {
    if (e instanceof LeadRunError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    throw e;
  }
}
