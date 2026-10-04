import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import {
  commitDaySplit,
  laneTargetsAreReachable,
  type CommitLane,
} from "@/lib/repo/dayPlan";

/** Commits a day-split proposal — the button the split panel was missing.
 *
 *  Takes the whole plan rather than one order, because that is what the manager decided: thirty
 *  orders across four days, applied together or not at all. The lanes arrive already grouped, so
 *  this handler validates SHAPE and nothing else — which orders belong to which day was decided
 *  by `planDaySplit` and the manager's own dragging, and re-deciding it here would be a second
 *  source of truth that disagrees with the screen.
 *
 *  No SQL here at all. The repo-boundary test allows a route to SELECT and never to INSERT, and a
 *  validation SELECT is how that boundary erodes one route at a time; reachability is a
 *  question about rows, so it lives in the repo with the rest of them. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as { lanes?: unknown } | null;
  if (!Array.isArray(body?.lanes)) {
    return NextResponse.json({ ok: false, error: "برنامه معتبر نیست" }, { status: 400 });
  }

  /* Shape first: ids must be positive integers, and a new lane's day must be an ISO date. A lane
     with nothing in it is dropped rather than sent — an empty day is a day with no work on it,
     and `createRun` would happily make one. */
  const wanted: CommitLane[] = [];
  for (const raw of body.lanes as CommitLane[]) {
    const orderIds = (Array.isArray(raw?.orderIds) ? raw.orderIds : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (orderIds.length === 0) continue;

    const day = typeof raw?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : "";
    wanted.push({
      runId: raw?.runId == null ? null : Number(raw.runId),
      driverUserId: Number(raw?.driverUserId) || null,
      day,
      orderIds,
    });
  }

  const db = getDb();
  // A lane the caller cannot reach is dropped rather than refused: their screen never showed it.
  const lanes = laneTargetsAreReachable(db, wanted, guard.session.organizationId);

  if (lanes.length === 0) {
    return NextResponse.json({ ok: false, error: "چیزی برای ثبت نبود" }, { status: 400 });
  }

  const result = commitDaySplit(db, lanes, {
    userId: guard.session.user.id,
    organizationId: guard.session.organizationId,
  });

  /* The refused list is part of the answer, not an error. A plan of thirty where two orders sat
     on a frozen route succeeded as far as it could, and the manager needs to know which two to
     deal with by hand — so the status is 201 with the count alongside. */
  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}