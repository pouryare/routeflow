import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { refreshPredictions } from "@/lib/repo/predictionRefresh";

export const dynamic = "force-dynamic";

/** The prediction sweep hook — a scheduler or a manual click. Refolds the demand
 *  models + forecasts, retrains + rescores churn, and folds completed runs into the
 *  learned capacity factors. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, ...refreshPredictions(guard.session.organizationId) });
}
