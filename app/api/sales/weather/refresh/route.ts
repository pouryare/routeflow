import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getDb } from "@/lib/db";
import { refreshForecast } from "@/lib/repo/weather";
import { groupFilter } from "@/lib/session";

/** Pull the forecast for the org's customer cells over the next few days. Glue -- a
 *  no-op (written = 0) when Open-Meteo is unreachable; whatever is stored stands. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { dates?: string[] } | null;

  const gf = groupFilter(guard.session);
  const cells = getDb()
    .prepare(
      `SELECT DISTINCT ROUND(lat, 2) AS lat, ROUND(lng, 2) AS lng
         FROM customers WHERE lat IS NOT NULL AND lng IS NOT NULL${gf.sql} LIMIT 60`
    )
    .all(...gf.params) as { lat: number; lng: number }[];

  const dates =
    body?.dates && body.dates.length > 0
      ? body.dates.map((d) => d.slice(0, 10))
      : [0, 1, 2].map((i) => new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10));

  const written = await refreshForecast(cells, dates);
  return NextResponse.json({ ok: true, written, cells: cells.length });
}
