import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { searchCustomers, searchOrders, searchUsers } from "@/lib/repo/search";

/** GET /api/search?q=… for the search overlay. Pages are matched client-side from the
 *  tabs the header already holds; this answers only what needs the database. Each half
 *  applies its own role and scope rules in lib/repo/search.ts. The role list here is
 *  just the union, so a driver is refused at the door. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  const db = getDb();
  return NextResponse.json(
    {
      ok: true,
      customers: searchCustomers(db, guard.session, q),
      orders: searchOrders(db, guard.session, q),
      users: searchUsers(db, guard.session, q),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
