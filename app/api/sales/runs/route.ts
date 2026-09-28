import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole, groupFilter, canReachGroup } from "@/lib/session";
import { createRun, DeliveryError } from "@/lib/delivery";

const PLANNERS = ["owner", "group_manager"] as const;

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...PLANNERS]);
  if (!guard.ok) return guard.response;

  const scope = groupFilter(guard.session, "dr.group_id");
  const runs = getDb()
    .prepare(
      `SELECT dr.id, dr.run_date, dr.status, u.display_name AS driver_name,
              COUNT(ds.id) AS stop_count,
              SUM(CASE WHEN ds.status = 'pending' THEN 1 ELSE 0 END) AS remaining,
              SUM(ds.collected_toman) AS collected_toman
         FROM delivery_runs dr
         JOIN users u ON u.id = dr.driver_user_id
         LEFT JOIN delivery_stops ds ON ds.run_id = dr.id
        WHERE 1 = 1${scope.sql}
        GROUP BY dr.id
        ORDER BY dr.run_date DESC, dr.id DESC
        LIMIT 60`
    )
    .all(...scope.params);

  return NextResponse.json({ ok: true, runs });
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

  const db = getDb();
  const driver = db
    .prepare("SELECT id, role, group_id FROM users WHERE id = ? AND active = 1")
    .get(Number(body?.driver_user_id)) as
    | { id: number; role: string; group_id: number | null }
    | undefined;

  // A driver outside the caller's group answers 404, like every other row they cannot
  // reach -- a 403 would confirm the account exists. The role test reads the SET, so a
  // driver whose primary is something else is still a driver.
  const canDrive = db
    .prepare("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'delivery_driver'")
    .get(Number(body?.driver_user_id));
  if (!driver || !canDrive || !canReachGroup(guard.session, driver.group_id)) {
    return NextResponse.json({ ok: false, error: "راننده پیدا نشد" }, { status: 404 });
  }

  try {
    const id = createRun(db, {
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
