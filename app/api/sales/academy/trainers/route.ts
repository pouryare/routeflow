import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { LessonError, setTrainer } from "@/lib/repo/academyLessons";

/** The owner gives or takes back the «مربی» permission: { user_id, on }. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { user_id?: unknown; on?: unknown } | null;
  if (!Number.isInteger(b?.user_id) || typeof b?.on !== "boolean") return NextResponse.json({ ok: false, error: "درخواست نامعتبر" }, { status: 400 });
  try {
    await setTrainer(guard.session, b.user_id as number, b.on);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof LessonError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    throw e;
  }
}
