import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { expiringBatches } from "@/lib/repo/batches";
import { complaintClusters } from "@/lib/repo/complaints";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const withinDays = req.nextUrl.searchParams.get("within_days");
  return NextResponse.json({
    ok: true,
    batches: expiringBatches(guard.session.organizationId, {
      withinDays: withinDays ? Number(withinDays) : undefined,
    }),
    clusters: complaintClusters(guard.session.organizationId),
  });
}
