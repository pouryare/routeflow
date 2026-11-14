import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { createCategory, deleteCategory, LessonError, renameCategory } from "@/lib/repo/academyLessons";

function failure(e: unknown) {
  if (e instanceof LessonError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  throw e;
}

export async function POST(req: NextRequest) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { title?: unknown } | null;
  try {
    return NextResponse.json({ ok: true, id: await createCategory(guard.session, b?.title) }, { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { id?: unknown; title?: unknown } | null;
  try {
    await renameCategory(guard.session, Number(b?.id), b?.title);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireRole(req, ROLES);
  if (!guard.ok) return guard.response;
  try {
    await deleteCategory(guard.session, Number(req.nextUrl.searchParams.get("id")));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
