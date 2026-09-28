import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { snapshotFor, runWeatherAdjustment } from "@/lib/repo/weather";
import { MANAGE_ROLES } from "@/lib/roles";

/** The stored snapshot for a cell/date plus the capacity adjustment it implies. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const date = sp.get("date");
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !date) {
    return NextResponse.json({ ok: false, error: "lat, lng و date لازم است" }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    snapshot: snapshotFor(lat, lng, date.slice(0, 10)) ?? null,
    adjustment: runWeatherAdjustment(guard.session.organizationId, {
      lat,
      lng,
      date: date.slice(0, 10),
    }),
  });
}
