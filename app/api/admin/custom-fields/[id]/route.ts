import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { updateField } from "@/lib/repo/customFields";

/** F122: the owner renames a field { name } or archives it { archived: true }. The type cannot change. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/custom-fields/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  const refused = await updateField(guard.session.organizationId, Number(id), ((await req.json().catch(() => null)) ?? {}) as object);
  return refused ? NextResponse.json({ ok: false, error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
}
