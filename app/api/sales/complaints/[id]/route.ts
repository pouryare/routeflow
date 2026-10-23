import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  complaintsRepo,
  updateComplaint,
  backwardTrace,
  ComplaintError,
  type ComplaintSeverity,
  type ComplaintStatus,
} from "@/lib/repo/complaints";
import { MANAGE_ROLES } from "@/lib/roles";

const SEVERITIES: ComplaintSeverity[] = ["low", "medium", "high", "critical"];
const STATUSES: ComplaintStatus[] = ["open", "investigating", "resolved", "dismissed"];

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/complaints/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const trace = await backwardTrace(guard.session.organizationId, Number(id));
  if (!trace) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, ...trace });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sales/complaints/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    status?: string;
    severity?: string;
    resolution?: string | null;
  } | null;

  if (
    (body?.status !== undefined && !STATUSES.includes(body.status as ComplaintStatus)) ||
    (body?.severity !== undefined && !SEVERITIES.includes(body.severity as ComplaintSeverity))
  ) {
    return NextResponse.json({ ok: false, error: "مقدار نامعتبر است" }, { status: 400 });
  }
  if (!await complaintsRepo.get(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  try {
    await updateComplaint(
      guard.session.organizationId,
      Number(id),
      {
        status: body?.status as ComplaintStatus | undefined,
        severity: body?.severity as ComplaintSeverity | undefined,
        resolution: body?.resolution,
      },
      guard.session.user.id
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof ComplaintError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
