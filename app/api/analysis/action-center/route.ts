import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { actionCenterFor } from "@/lib/repo/actionCenter";

export const dynamic = "force-dynamic";

/** The ranked critical / warning / opportunity buckets for this session. */
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "rep_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, buckets: actionCenterFor(guard.session) });
}
