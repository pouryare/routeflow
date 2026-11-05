import { NextRequest, NextResponse } from "next/server";
import { orgScopeId, requireRole, type Session } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { guardStepUp } from "@/lib/repo/stepUp";

/** The company owner or the platform owner acting as that company (decision 4). A platform owner
 *  looking at every company has to pick one first: storages belong to a company. With `write`, the
 *  authenticator code is asked as well (step-up `storage_change`, asked even when the company switch is off). */
export async function storageOwner(req: NextRequest, write = false): Promise<{ ok: true; session: Session; org: number } | { ok: false; response: NextResponse }> {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard;
  const org = orgScopeId(guard.session);
  if (org == null) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "اول یک شرکت را انتخاب کنید" }, { status: 400 }) };
  }
  if (write) {
    const stepUp = await guardStepUp(req, guard.session, "storage_change");
    if (stepUp) return { ok: false, response: stepUp };
  }
  return { ok: true, session: guard.session, org };
}

export const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });
