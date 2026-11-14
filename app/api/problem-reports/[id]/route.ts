import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { OWNER_ROLES } from "@/lib/roles";
import { markReportDone, screenshotOf } from "@/lib/repo/problemReports";
import { isId } from "@/lib/inputChecks";

/** The owner opens the screenshot of a report. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/problem-reports/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const shot = await screenshotOf(guard.session.organizationId, Number(id));
  if (!shot) return NextResponse.json({ ok: false, error: "تصویری نیست" }, { status: 404 });
  return NextResponse.json({ ok: true, screenshot: shot });
}

/** The owner marks a report done. */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/problem-reports/[id]">) {
  const guard = await requireRole(req, OWNER_ROLES);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  await markReportDone(guard.session.organizationId, Number(id));
  return NextResponse.json({ ok: true });
}
