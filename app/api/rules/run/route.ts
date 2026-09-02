import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { runSweepRules, escalateStaleRuns } from "@/lib/repo/rules";

/** The periodic hook a scheduler (or a manual click) calls. */
export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;
  const fired = runSweepRules(guard.session.organizationId);
  const escalated = escalateStaleRuns(guard.session.organizationId);
  return NextResponse.json({ ok: true, fired: fired.length, escalated });
}
