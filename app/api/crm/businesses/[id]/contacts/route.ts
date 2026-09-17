import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { getBusiness } from "@/lib/repo/crm/businesses";
import { getDb, plain } from "@/lib/db";
import { addContact, type ContactInput } from "@/lib/repo/crm/contacts";
import { CRM_ROLES, crmErrorResponse, idParam } from "@/lib/repo/crm/http";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  const b = id === null ? null : getBusiness(guard.session, id);
  if (!b) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  const contacts = plain(getDb().prepare("SELECT id, name, role, phone_norm, whatsapp, is_primary, is_decider, best_time, note FROM contacts WHERE customer_id = ? AND organization_id = ? AND active = 1 ORDER BY is_primary DESC, id").all(b.id, b.organization_id));
  return NextResponse.json({ ok: true, contacts });
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
