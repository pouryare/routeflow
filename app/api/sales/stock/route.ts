import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { stockPosition, readPurchases } from "@/lib/purchases";
import { expiringBatches } from "@/lib/repo/batches";
import { stockLevels } from "@/lib/repo/stock";

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
  const org = guard.session.organizationId;
  // Phase 2: attach the soonest expiry per product and a company-wide expiring count.
  const expiryByProduct = new Map(stockLevels(org).map((l) => [l.product_id, l.earliest_expiry]));
  const stock = stockPosition(db).map((row) => ({
    ...row,
    earliest_expiry: expiryByProduct.get(row.product_id) ?? null,
  }));
  return NextResponse.json({
    ok: true,
    stock,
    expiring_count: expiringBatches(org).length,
    purchases: guard.session.role === "owner" ? readPurchases(db, org, 25) : [],
  });
}
