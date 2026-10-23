import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { verifyBusiness } from "@/lib/repo/crm/fields";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (body?.confirmed !== true) return NextResponse.json({ ok: false, error: "تأیید اطلاعات لازم است" }, { status: 400 });
  try { await verifyBusiness(guard.session, id); return NextResponse.json({ ok: true }); }
  catch (e) { return crmErrorResponse(e); }
}
