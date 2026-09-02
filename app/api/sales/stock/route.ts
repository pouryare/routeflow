import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { stockPosition, readPurchases } from "@/lib/purchases";

/** The warehouse position.
 *
 *  Readable by anyone who sells -- knowing whether there is stock is part of taking an
 *  order, and a فروشنده promising goods that are not there is the failure this prevents.
 *  Purchase history is owner-only: what we paid a supplier is not a selling figure.
 */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson"]);
  if (!guard.ok) return guard.response;

  const db = getDb();
  return NextResponse.json({
    ok: true,
    stock: stockPosition(db),
    purchases: guard.session.role === "owner" ? readPurchases(db, guard.session.organizationId, 25) : [],
  });
}
