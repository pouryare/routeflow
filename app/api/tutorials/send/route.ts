import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { assignmentsSentBy, sendTutorial } from "@/lib/repo/tutorials";
import { TUTOR_ROLES } from "@/lib/tutorials/catalog";

/** Idea I7: a manager sends one tutorial to one person of the company, and reads back sent, seen and done. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, TUTOR_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { user_id?: unknown; tutorial_id?: unknown } | null;
  if (!body || !Number.isInteger(body.user_id) || typeof body.tutorial_id !== "string") {
    return NextResponse.json({ ok: false, error: "دادهٔ نامعتبر" }, { status: 400 });
  }
  const id = await sendTutorial(guard.session.organizationId, body.user_id as number, body.tutorial_id, guard.session.user.id);
  if (id === null) return NextResponse.json({ ok: false, error: "این آموزش یا این همکار پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, id });
}

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, TUTOR_ROLES);
  if (!guard.ok) return guard.response;
  return NextResponse.json({ ok: true, sent: await assignmentsSentBy(guard.session.organizationId, guard.session.user.id) });
}
