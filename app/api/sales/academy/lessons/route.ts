import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { academyManifest, lessonProgress, markLessonDone } from "@/lib/repo/academy";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson", "driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    ok: true,
    modules: academyManifest(),
    progress: lessonProgress(guard.session.organizationId, guard.session.user.id),
  });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager", "salesperson", "driver", "rep_manager"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { lesson_slug?: string } | null;
  if (!b?.lesson_slug) return NextResponse.json({ ok: false, error: "درس مشخص نشده" }, { status: 400 });
  markLessonDone(guard.session.organizationId, guard.session.user.id, b.lesson_slug);
  return NextResponse.json({ ok: true }, { status: 201 });
}
