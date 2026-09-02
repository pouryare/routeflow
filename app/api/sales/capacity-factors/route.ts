import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { capacityFactorsFor, upsertCapacityFactor } from "@/lib/repo/weather";
import { CONDITION_CODES } from "@/lib/weather/conditions";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, factors: capacityFactorsFor(guard.session.organizationId) });
}

export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.condition_code || !CONDITION_CODES.includes(b.condition_code as never)) {
    return NextResponse.json({ ok: false, error: "شرایط نامعتبر است" }, { status: 400 });
  }
  const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  upsertCapacityFactor(guard.session.organizationId, {
    condition_code: String(b.condition_code),
    stop_factor: num(b.stop_factor, 1),
    service_time_factor: num(b.service_time_factor, 1),
    speed_factor: num(b.speed_factor, 1),
    max_duration_factor: num(b.max_duration_factor, 1),
    note_fa: (b.note_fa as string | null) ?? null,
    active: b.active !== false,
  });
  return NextResponse.json({ ok: true });
}
