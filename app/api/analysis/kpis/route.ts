import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { kpiBoard } from "@/lib/repo/kpiSnapshots";
import { currentPeriod, shiftPeriod } from "@/lib/analysis/period";

export const dynamic = "force-dynamic";

/** The KPI strip. Reads `kpi_snapshots` + `targets` + `kpi_definitions` only — never
 *  scans `orders`. Scoped inside `kpiBoard` by the session's role. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "rep_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const period = req.nextUrl.searchParams.get("period") ?? currentPeriod();
  const prev = req.nextUrl.searchParams.get("prev") ?? shiftPeriod(period, 1);

  return NextResponse.json({
    ok: true,
    period,
    prev_period: prev,
    cards: kpiBoard(guard.session.organizationId, period, prev, guard.session),
  });
}
