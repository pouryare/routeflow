import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { updateTags } from "@/lib/repo/crm/intel";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";

type Context = { params: Promise<{ id: string }> };
export async function PUT(req: NextRequest, ctx: Context) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { tags?: unknown } | null;
  try {
    await updateTags(guard.session, id, body === null || body === undefined ? null : body.tags ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) { return crmErrorResponse(e); }
}
