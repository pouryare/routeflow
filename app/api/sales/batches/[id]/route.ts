import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { batchesRepo, advanceBatchStatus, BatchError } from "@/lib/repo/batches";
import type { BatchStatus } from "@/lib/batchStates";
import { BATCH_TRANSITIONS } from "@/lib/batchStates";

const STATUSES = Object.keys(BATCH_TRANSITIONS) as BatchStatus[];

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sales/batches/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const batch = batchesRepo.get(guard.session.organizationId, Number(id));
  if (!batch) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  return NextResponse.json({ ok: true, batch });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/sales/batches/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { action?: string; to?: string } | null;
  if (body?.action !== "status" || !body.to || !STATUSES.includes(body.to as BatchStatus)) {
    return NextResponse.json({ ok: false, error: "کنش نامعتبر است" }, { status: 400 });
  }
  if (!batchesRepo.get(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  try {
    advanceBatchStatus(guard.session.organizationId, Number(id), body.to as BatchStatus);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BatchError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
