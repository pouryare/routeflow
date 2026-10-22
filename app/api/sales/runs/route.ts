import { NextRequest, NextResponse } from "next/server";
import { requireRole, groupFilter, canReachGroup, orgScopeId } from "@/lib/session";
import { DeliveryError } from "@/lib/delivery";
import { findDriverInOrg, listRuns, newRun } from "@/lib/repo/deliveryRunsAdmin";

const PLANNERS = ["platform_owner", "owner", "group_manager"] as const;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...PLANNERS]);
  if (!guard.ok) return guard.response;

  const scope = groupFilter(guard.session, "dr.group_id");
  return NextResponse.json({ ok: true, runs: listRuns(scope, orgScopeId(guard.session)) });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, [...PLANNERS]);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    driver_user_id?: unknown;
    run_date?: unknown;
  } | null;

  const runDate = typeof body?.run_date === "string" ? body.run_date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate) || Number.isNaN(Date.parse(runDate))) {
    return NextResponse.json({ ok: false, error: "تاریخ مسیر معتبر نیست" }, { status: 400 });
  }

  // A driver outside the caller's company or group answers 404, like every other row they cannot
  // reach -- a 403 would confirm the account exists. The role test reads the SET, so a driver whose
  // primary is something else is still a driver.
  const driver = findDriverInOrg(Number(body?.driver_user_id), orgScopeId(guard.session));
  if (!driver || !canReachGroup(guard.session, driver.group_id)) {
    return NextResponse.json({ ok: false, error: "راننده پیدا نشد" }, { status: 404 });
  }

  try {
    const id = newRun({
      driver_user_id: driver.id,
      run_date: runDate,
      created_by: guard.session.user.id,
      organization_id: guard.session.organizationId,
      group_id: driver.group_id,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof DeliveryError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    }
    // UNIQUE(driver, date). Two runs for one driver on one day is always a mistake, and
    // an unhandled constraint here would be a 500 on an ordinary double-click.
    if (e instanceof Error && /UNIQUE/.test(e.message)) {
      return NextResponse.json(
        { ok: false, error: "برای این راننده در این تاریخ مسیر ثبت شده است" },
        { status: 400 }
      );
    }
    throw e;
  }
}
