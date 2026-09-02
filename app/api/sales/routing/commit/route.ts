import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { commitPlan, type RoutingPlan } from "@/lib/repo/routing";

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { plan?: RoutingPlan } | null;
  if (!b?.plan?.date || !Array.isArray(b.plan.assignments)) {
    return NextResponse.json({ ok: false, error: "پیشنهاد نامعتبر است" }, { status: 400 });
  }
  const res = commitPlan(guard.session.organizationId, b.plan, { planned_by: guard.session.user.id });
  return NextResponse.json({ ok: true, ...res });
}
