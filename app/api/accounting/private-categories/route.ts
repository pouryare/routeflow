import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { setCategoryPrivate } from "@/lib/repo/privateCategories";

/** Z11: the owner marks an expense category private or public: { account_id, on }. */
export async function PUT(req: NextRequest) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const body = (await req.json().catch(() => null)) as { account_id?: unknown; on?: unknown } | null;
  if (!isId(String(body?.account_id ?? "")) || typeof body?.on !== "boolean") return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  if (!(await setCategoryPrivate(guard.session.organizationId, Number(body.account_id), body.on))) return NextResponse.json({ ok: false, error: "دسته پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
