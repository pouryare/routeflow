import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { batchTrace } from "@/lib/repo/batches";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/batches/[id]/trace">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const trace = await batchTrace(guard.session.organizationId, Number(id));
  if (!trace) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, ...trace });
}
