import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { profileFor } from "@/lib/repo/crm/profile";
import { updateBusinessFields } from "@/lib/repo/crm/fields";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";

type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, ctx: Context) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  const profile = id === null ? null : profileFor(guard.session, id);
  if (!profile) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, profile });
}
export async function PATCH(req: NextRequest, ctx: Context) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  try {
    updateBusinessFields(guard.session, id, await req.json().catch(() => null));
    return NextResponse.json({ ok: true, profile: profileFor(guard.session, id) });
  } catch (e) { return crmErrorResponse(e); }
}
