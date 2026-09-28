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
  const guard = requireRole(req, ["owner", "group_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const db = getDb();
  const org = guard.session.organizationId;
  // Phase 2: soonest expiry per product + a company-wide expiring count.
  // Phase 3: reserved (claimed by confirmed orders) and available-to-promise.
  const levelByProduct = new Map(stockLevels(org).map((l) => [l.product_id, l]));
  const stock = stockPosition(db).map((row) => {
    const lvl = levelByProduct.get(row.product_id);
    return {
      ...row,
      earliest_expiry: lvl?.earliest_expiry ?? null,
      reserved: lvl?.reserved ?? 0,
      available: lvl ? lvl.available : row.on_hand,
    };
  });
  return NextResponse.json({
    ok: true,
    stock,
    expiring_count: expiringBatches(org).length,
    purchases: guard.session.role === "owner" ? readPurchases(db, org, 25) : [],
  });
}
