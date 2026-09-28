import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { refreshOrgForecast } from "@/lib/repo/weather";
import { MANAGE_ROLES } from "@/lib/roles";

/** Pull the forecast for the org's customer cells over the next few days. Glue -- a
 *  no-op (written = 0) when Open-Meteo is unreachable; whatever is stored stands. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { dates?: string[] } | null;
  const res = await refreshOrgForecast(guard.session, body?.dates);
  return NextResponse.json({ ok: true, ...res });
}
