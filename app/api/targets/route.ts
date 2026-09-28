import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listTargets, setTarget, type TargetMetric } from "@/lib/repo/targets";
import { MANAGE_ROLES } from "@/lib/roles";

const METRICS: TargetMetric[] = ["revenue_toman", "kg", "orders"];

export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const period = req.nextUrl.searchParams.get("period") ?? undefined;
  return NextResponse.json({ ok: true, targets: listTargets(guard.session.organizationId, period) });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.period || !METRICS.includes(b.metric as TargetMetric) || typeof b.target_value !== "number") {
    return NextResponse.json({ ok: false, error: "دوره، متریک و مقدار لازم است" }, { status: 400 });
  }
  const id = setTarget(guard.session.organizationId, {
    user_id: (b.user_id as number | null) ?? null,
    group_id: (b.group_id as number | null) ?? null,
    period: String(b.period),
    metric: b.metric as TargetMetric,
    target_value: b.target_value,
    created_by: guard.session.user.id,
  });
  return NextResponse.json({ ok: true, id }, { status: 201 });
}
