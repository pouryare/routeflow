import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { academyManifest, AcademyError, lessonProgress, markLessonDone } from "@/lib/repo/academy";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    ok: true,
    modules: academyManifest(),
    progress: await lessonProgress(guard.session.organizationId, guard.session.user.id),
  });
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales", "field_rep", "delivery_driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { lesson_slug?: string } | null;
  if (!b?.lesson_slug) return NextResponse.json({ ok: false, error: "درس مشخص نشده" }, { status: 400 });
  try {
    await markLessonDone(guard.session.organizationId, guard.session.user.id, b.lesson_slug);
  } catch (e) {
    if (e instanceof AcademyError) return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
