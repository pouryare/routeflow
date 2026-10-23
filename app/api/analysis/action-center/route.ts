import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { actionCenterFor } from "@/lib/repo/actionCenter";
import { MANAGE_ROLES } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The ranked critical / warning / opportunity buckets for this session. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "rep_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, buckets: await actionCenterFor(guard.session) });
}
