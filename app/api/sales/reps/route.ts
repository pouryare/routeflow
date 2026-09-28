import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { repsOverview } from "@/lib/repo/repHealth";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "rep_manager"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, reps: repsOverview(guard.session.organizationId) });
}
