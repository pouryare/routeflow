import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { commitPlan, type RoutingPlan } from "@/lib/repo/routing";
import { MANAGE_ROLES } from "@/lib/roles";
import { isDayWithin } from "@/lib/inputChecks";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { plan?: RoutingPlan } | null;
  if (!b?.plan?.date || !Array.isArray(b.plan.assignments)) {
    return NextResponse.json({ ok: false, error: "پیشنهاد نامعتبر است" }, { status: 400 });
  }
  // The plan comes back from the browser, so it is checked as input: a real day near today, and sane
  // per-vehicle figures. A date of "zzzzzzzzzz" created a run, and distance -5 / duration 1e15 were stored.
  const sane = (n: unknown, max: number) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
  if (
    !isDayWithin(b.plan.date, 30, 120) ||
    b.plan.assignments.length > 100 ||
    !b.plan.assignments.every(
      (a) =>
        Number.isInteger(a?.vehicle_key) &&
        sane(a.distance_km, 5000) &&
        sane(a.duration_min, 10_000) &&
        Array.isArray(a.stops) &&
        a.stops.length <= 200 &&
        a.stops.every((s) => Number.isInteger(s?.delivery_id) && Number.isInteger(s?.sort_order)),
    )
  ) {
    return NextResponse.json({ ok: false, error: "پیشنهاد نامعتبر است" }, { status: 400 });
  }
  const res = commitPlan(guard.session.organizationId, b.plan, { planned_by: guard.session.user.id });
  return NextResponse.json({ ok: true, ...res });
}
