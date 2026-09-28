import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { pocketFor } from "@/lib/repo/pocket";

/** The member's personal task view. Any authenticated non-platform role reads their own;
 *  a manager may pass ?user_id= to see a report's (enforced in pocketFor via canReachUser). */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, [
    "owner",
    "group_manager",
    "rep_manager",
    "phone_sales",
    "field_rep",
    "delivery_driver",
    "platform_owner",
  ]);
  if (!guard.ok) return guard.response;
  const raw = req.nextUrl.searchParams.get("user_id");
  const scopeUserId = raw ? Number(raw) : undefined;
  return NextResponse.json({
    ok: true,
    pocket: pocketFor(guard.session, { scopeUserId: Number.isFinite(scopeUserId) ? scopeUserId : undefined }),
  });
}
