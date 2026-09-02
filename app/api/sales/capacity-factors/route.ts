import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db";
import { capacityFactorsFor } from "@/lib/repo/weather";
import { CONDITION_CODES } from "@/lib/weather/conditions";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, factors: capacityFactorsFor(guard.session.organizationId) });
}

/** Set a tenant override for one condition. Upsert on (organization_id, condition_code). */
export async function PATCH(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as {
    condition_code?: string;
    stop_factor?: number;
    service_time_factor?: number;
    speed_factor?: number;
    max_duration_factor?: number;
    note_fa?: string | null;
    active?: boolean;
  } | null;
  if (!b?.condition_code || !CONDITION_CODES.includes(b.condition_code as never)) {
    return NextResponse.json({ ok: false, error: "شرایط نامعتبر است" }, { status: 400 });
  }
  const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? v : d);
  getDb()
    .prepare(
      `INSERT INTO capacity_factors
         (organization_id, condition_code, stop_factor, service_time_factor, speed_factor,
          max_duration_factor, note_fa, active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (organization_id, condition_code) DO UPDATE SET
         stop_factor = excluded.stop_factor, service_time_factor = excluded.service_time_factor,
         speed_factor = excluded.speed_factor, max_duration_factor = excluded.max_duration_factor,
         note_fa = excluded.note_fa, active = excluded.active, updated_at = excluded.updated_at`
    )
    .run(
      guard.session.organizationId,
      b.condition_code,
      num(b.stop_factor, 1),
      num(b.service_time_factor, 1),
      num(b.speed_factor, 1),
      num(b.max_duration_factor, 1),
      b.note_fa ?? null,
      b.active === false ? 0 : 1,
      new Date().toISOString()
    );
  return NextResponse.json({ ok: true });
}
