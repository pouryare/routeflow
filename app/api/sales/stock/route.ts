import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole } from "@/lib/session";
import { stockView } from "@/lib/repo/salesWrites";
import { MANAGE_ROLES, isOwner } from "@/lib/roles";


/** The warehouse position.
 *
 *  Readable by anyone who sells -- knowing whether there is stock is part of taking an
 *  order, and a فروشنده promising goods that are not there is the failure this prevents.
 *  Purchase history is owner-only: what we paid a supplier is not a selling figure.
 */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const org = guard.session.organizationId;
  // Phase 2: soonest expiry per product + a company-wide expiring count.
  // Phase 3: reserved (claimed by confirmed orders) and available-to-promise.
  const { stock, expiringCount, purchases } = await stockView(org, orgScopeId(guard.session), isOwner(guard.session.role));
  return NextResponse.json({
    ok: true,
    stock,
    expiring_count: expiringCount,
    purchases,
  });
}
