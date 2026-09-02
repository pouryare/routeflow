import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { refreshAll } from "@/lib/repo/analysisRefresh";

export const dynamic = "force-dynamic";

/** The analysis sweep hook — a scheduler or a manual click. Recomputes the current +
 *  prior Jalali month's KPI snapshots and the margin / health roll-ups. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const result = refreshAll(guard.session.organizationId);
  return NextResponse.json({ ok: true, ...result });
}
