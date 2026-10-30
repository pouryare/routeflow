import { NextRequest, NextResponse } from "next/server";
import { isId } from "@/lib/inputChecks";
import { requireRole } from "@/lib/session";
import { batchesRepo, advanceBatchStatus, BatchError } from "@/lib/repo/batches";
import type { BatchStatus } from "@/lib/batchStates";
import { BATCH_TRANSITIONS } from "@/lib/batchStates";
import { MANAGE_ROLES } from "@/lib/roles";

const STATUSES = Object.keys(BATCH_TRANSITIONS) as BatchStatus[];

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/batches/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const batch = await batchesRepo.get(guard.session.organizationId, Number(id));
  if (!batch) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, batch });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sales/batches/[id]">) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (!isId(id)) return NextResponse.json({ ok: false, error: "شناسه نامعتبر است" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { action?: string; to?: string } | null;
  if (body?.action !== "status" || !body.to || !STATUSES.includes(body.to as BatchStatus)) {
    return NextResponse.json({ ok: false, error: "کنش نامعتبر است" }, { status: 400 });
  }
  if (!await batchesRepo.get(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  try {
    await advanceBatchStatus(guard.session.organizationId, Number(id), body.to as BatchStatus);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BatchError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
