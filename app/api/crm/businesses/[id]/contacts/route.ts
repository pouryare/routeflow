import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { profileFor } from "@/lib/repo/crm/profile";
import { addContact, type ContactInput } from "@/lib/repo/crm/contacts";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  const profile = id === null ? null : profileFor(guard.session, id);
  if (!profile) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, contacts: profile.contacts });
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  if (id === null) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  try {
    const contact = addContact(guard.session, id, await req.json().catch(() => null) as ContactInput);
    return NextResponse.json({ ok: true, contact }, { status: 201 });
  } catch (e) { return crmErrorResponse(e); }
}
