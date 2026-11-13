import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { deleteLesson, getCompanyLesson, LessonError, saveLesson, type LessonInput } from "@/lib/repo/academyLessons";

function failure(e: unknown) {
  if (e instanceof LessonError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

/** One company lesson, for the editor (`?id=`). */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const id = Number(req.nextUrl.searchParams.get("id"));
  const lesson = Number.isInteger(id) ? await getCompanyLesson(guard.session, id) : null;
  if (!lesson) return NextResponse.json({ ok: false, error: "درس پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, lesson });
}

/** Create a lesson, or edit one when the body has `id`. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as LessonInput | null;
  if (!body) return NextResponse.json({ ok: false, error: "درخواست نامعتبر" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, id: await saveLesson(guard.session, body) }, { status: body.id ? 200 : 201 });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر" }, { status: 400 });
  try {
    await deleteLesson(guard.session, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
