import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { snapshotFor } from "@/lib/repo/crm/snapshot";
import { CRM_ROLES, idParam } from "@/lib/repo/crm/http";

/** F104: the pre-call card for one customer. Same scope check as the customer page. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/crm/businesses/[id]/snapshot">) {
  const guard = await requireRole(req, [...CRM_ROLES]);
  if (!guard.ok) return guard.response;
  const id = idParam((await ctx.params).id);
  const s = id === null ? null : await snapshotFor(guard.session, id);
  if (!s) return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, snapshot: s });
}
