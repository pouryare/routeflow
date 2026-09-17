import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { timelineFor } from "@/lib/repo/crm/profile";
import { TIMELINE_KINDS, decodeTimelineCursor } from "@/lib/crm/timeline";
import { isOneOf } from "@/lib/crm/vocab";
import { CRM_ROLES, idParam } from "@/lib/repo/crm/http";
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  const before = req.nextUrl.searchParams.get("before");
  const kind = req.nextUrl.searchParams.get("kind");
  if (kind && !isOneOf(TIMELINE_KINDS, kind)) return NextResponse.json({ ok: false, error: "نوع تاریخچه نامعتبر است" }, { status: 400 });
  try { if (before) decodeTimelineCursor(before); }
  catch { return NextResponse.json({ ok: false, error: "نشانگر تاریخچه نامعتبر است" }, { status: 400 }); }
  const result = id === null ? null : timelineFor(guard.session, id, { before, kind: isOneOf(TIMELINE_KINDS, kind) ? kind : null });
  if (!result) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, ...result });
}
