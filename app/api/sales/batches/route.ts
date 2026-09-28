import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { createBatch, listBatches, expiringBatches, BatchError } from "@/lib/repo/batches";
import type { BatchStatus } from "@/lib/batchStates";
import { BATCH_TRANSITIONS } from "@/lib/batchStates";
import { MANAGE_ROLES } from "@/lib/roles";

const STATUSES = Object.keys(BATCH_TRANSITIONS) as BatchStatus[];

export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  if (sp.get("expiring") === "1") {
    return NextResponse.json({ ok: true, batches: expiringBatches(guard.session.organizationId) });
  }
  const productId = sp.get("product_id");
  const status = sp.get("status");
  return NextResponse.json({
    ok: true,
    batches: listBatches(guard.session.organizationId, {
      product_id: productId ? Number(productId) : undefined,
      status: STATUSES.includes(status as BatchStatus) ? (status as BatchStatus) : undefined,
    }),
  });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    product_id?: number;
    batch_code?: string | null;
    supplier_batch_ref?: string | null;
    produced_at?: string | null;
    expiry_date?: string | null;
    qty_received_base?: number;
    unit_cost_toman?: number | null;
    notes?: string | null;
  } | null;

  if (!body?.product_id || !(Number(body.qty_received_base) > 0)) {
    return NextResponse.json({ ok: false, error: "کالا و مقدار دریافتی لازم است" }, { status: 400 });
  }

  try {
    const id = createBatch(guard.session.organizationId, {
      product_id: Number(body.product_id),
      batch_code: body.batch_code ?? null,
      supplier_batch_ref: body.supplier_batch_ref ?? null,
      produced_at: body.produced_at ?? null,
      expiry_date: body.expiry_date ?? null,
      qty_received_base: Number(body.qty_received_base),
      unit_cost_toman: body.unit_cost_toman ?? 0,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof BatchError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
