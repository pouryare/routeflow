import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { setIdleRules } from "@/lib/repo/idleSignout";

/** The owner's idle sign-out hours per role (E17). PUT { hours: { owner: 12, ... } }; 0 or empty means never. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { hours?: Record<string, unknown> } | null;
  const problem = await setIdleRules(guard.session.organizationId, body?.hours ?? {});
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
  return NextResponse.json({ ok: true });
}
