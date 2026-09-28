import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { listVehicles, createVehicle, RoutingError } from "@/lib/repo/routing";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, vehicles: listVehicles(guard.session.organizationId, false) });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.name) return NextResponse.json({ ok: false, error: "نام لازم است" }, { status: 400 });
  try {
    const id = createVehicle(guard.session.organizationId, {
      name: String(b.name),
      plate: (b.plate as string | null) ?? null,
      driver_default_id: (b.driver_default_id as number | null) ?? null,
      max_weight_kg: (b.max_weight_kg as number | null) ?? null,
      max_volume_m3: (b.max_volume_m3 as number | null) ?? null,
      max_stops: (b.max_stops as number | null) ?? null,
      has_refrigeration: b.has_refrigeration === true,
      cost_per_km_toman: (b.cost_per_km_toman as number | undefined) ?? 0,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof RoutingError) return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    throw e;
  }
}
