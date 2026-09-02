import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listRouteTemplates, createRouteTemplate, RoutingError } from "@/lib/repo/routing";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, templates: listRouteTemplates(guard.session.organizationId) });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.code || !b?.name) {
    return NextResponse.json({ ok: false, error: "کد و نام لازم است" }, { status: 400 });
  }
  try {
    const id = createRouteTemplate(guard.session.organizationId, {
      code: String(b.code),
      name: String(b.name),
      territory_id: (b.territory_id as number | null) ?? null,
      default_driver_id: (b.default_driver_id as number | null) ?? null,
      default_vehicle_id: (b.default_vehicle_id as number | null) ?? null,
      max_stops: (b.max_stops as number | null) ?? null,
      max_weight_kg: (b.max_weight_kg as number | null) ?? null,
      max_volume_m3: (b.max_volume_m3 as number | null) ?? null,
      max_duration_min: (b.max_duration_min as number | null) ?? null,
      service_time_min: (b.service_time_min as number | undefined) ?? 8,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof RoutingError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
