import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { applyIntel } from "@/lib/repo/crm/intel";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";

type Context = { params: Promise<{ id: string }> };
export async function POST(req: NextRequest, ctx: Context) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { answers?: unknown; client_uuid?: unknown } | null;
  try {
    const r = await applyIntel(guard.session, id, { answers: b?.answers ?? null, clientUuid: typeof b?.client_uuid === "string" ? b.client_uuid : null });
    return NextResponse.json({ ok: true, activityId: r.activityId });
  } catch (e) { return crmErrorResponse(e); }
}

