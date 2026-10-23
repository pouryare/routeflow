import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { updateContact, type ContactInput } from "@/lib/repo/crm/contacts";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";

type Context = { params: Promise<{ id: string; contactId: string }> };
async function write(req: NextRequest, ctx: Context, archive: boolean) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const params = await ctx.params;
  const id = idParam(params.id), contactId = idParam(params.contactId);
  if (id === null || contactId === null) return NextResponse.json({ ok: false, error: "مخاطب پیدا نشد" }, { status: 404 });
  try {
    const input = archive ? { active: false } : await req.json().catch(() => null) as ContactInput;
    await updateContact(guard.session, contactId, input, id);
    return NextResponse.json({ ok: true });
  } catch (e) { return crmErrorResponse(e); }
}
export async function PATCH(req: NextRequest, ctx: Context) { return write(req, ctx, false); }
export async function DELETE(req: NextRequest, ctx: Context) { return write(req, ctx, true); }
