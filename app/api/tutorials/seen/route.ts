import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { markAssignment } from "@/lib/repo/tutorials";
import { ROLES } from "@/lib/roles";

/** The person opened («seen») or finished («done») a tutorial a manager sent them. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...ROLES]);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { id?: unknown; what?: unknown } | null;
  if (!body || typeof body.id !== "string" || (body.what !== "seen" && body.what !== "done")) {
    return NextResponse.json({ ok: false, error: "دادهٔ نامعتبر" }, { status: 400 });
  }
  await markAssignment(guard.session.organizationId, guard.session.user.id, body.id, body.what);
  return NextResponse.json({ ok: true });
}
