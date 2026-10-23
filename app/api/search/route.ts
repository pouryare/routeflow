import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { searchIn } from "@/lib/repo/routeAdapters";
import { MANAGE_ROLES } from "@/lib/roles";

/** GET /api/search?q=… for the search overlay. Pages are matched client-side from the
 *  tabs the header already holds; this answers only what needs the database. Each half
 *  applies its own role and scope rules in lib/repo/search.ts. The role list here is
 *  just the union, so a driver is refused at the door. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  return NextResponse.json(
    {
      ok: true,
      // Districts is shared reference data with no tenant row, so searchDistricts applies
      // no scope of its own -- but it still goes through the same door guard, because this
      // route is a read path and a new kind in it is a new place to leak.
      ...await searchIn(guard.session, q),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
