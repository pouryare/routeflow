import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { closeDay } from "@/lib/repo/wrapUp";

/** F74: «روز را بستم». Marks today closed for the caller; saying it twice changes nothing. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ["owner", "platform_owner", "group_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;
  await closeDay(guard.session.organizationId, guard.session.user.id);
  return NextResponse.json({ ok: true });
}
