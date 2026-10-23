import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { flowContextFor } from "@/lib/repo/crm/businesses";
import { CRM_ROLES, idParam } from "@/lib/repo/crm/http";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/crm/businesses/[id]/context">) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  const entry = req.nextUrl.searchParams.get("entry") === "talked_now" ? "talked_now" : "call";
  const r = id === null ? null : await flowContextFor(guard.session, id, entry);
  if (!r) return NextResponse.json({ ok: false, error: "کسب‌وکار پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, business: r.business, ctx: r.ctx });
}
