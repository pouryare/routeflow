import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getPrefs } from "@/lib/repo/prefs";
import { openAssignmentsFor } from "@/lib/repo/tutorials";
import { ROLES } from "@/lib/roles";

/** The person's role, their tutorial progress and what a manager sent them (components/tutorials). */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const { session } = guard;
  const prefs = await getPrefs(session.user.id);
  return NextResponse.json({
    ok: true,
    role: session.role,
    progress: prefs.tutorials ?? {},
    assignments: await openAssignmentsFor(session.organizationId, session.user.id),
  });
}
