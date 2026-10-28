import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { guardStepUp, setStepUpRequired, stepUpRequiredFor } from "@/lib/repo/stepUp";

/** Whether the company asks for an authenticator code before sensitive actions. Owner only; turning it
 *  off asks for a code too, so a hijacked session cannot quietly remove the protection. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, required: await stepUpRequiredFor(guard.session.organizationId) });
}

export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { required?: unknown } | null;
  if (typeof body?.required !== "boolean") return NextResponse.json({ ok: false, error: "مقدار نامعتبر است" }, { status: 400 });
  const refusal = await guardStepUp(req, guard.session, "owner_settings");
  if (refusal) return refusal;
  await setStepUpRequired(guard.session.organizationId, body.required);
  return NextResponse.json({ ok: true, required: body.required });
}
