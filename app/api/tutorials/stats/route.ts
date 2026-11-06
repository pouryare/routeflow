import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { countStep, isTutorialEvent, stepCounts } from "@/lib/repo/tutorials";
import { OWNER_ROLES, ROLES } from "@/lib/roles";

/** Idea I12: every person adds one to a step's count (no name is stored); the owner reads the counts. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { id?: unknown; step?: unknown; event?: unknown } | null;
  if (!body || typeof body.id !== "string" || typeof body.step !== "number" || !isTutorialEvent(body.event)) {
    return NextResponse.json({ ok: false, error: "دادهٔ نامعتبر" }, { status: 400 });
  }
  await countStep(guard.session.organizationId, body.id, body.step, body.event);
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, counts: await stepCounts(guard.session.organizationId) });
}
