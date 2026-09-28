import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { batchTrace } from "@/lib/repo/batches";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/batches/[id]/trace">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const trace = batchTrace(guard.session.organizationId, Number(id));
  if (!trace) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, ...trace });
}
