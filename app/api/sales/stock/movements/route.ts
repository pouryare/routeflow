import { boundedText, isDayWithin, isQuantity, isTimestampWithin } from "@/lib/inputChecks";
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  listMovements,
  recordMovement,
  defaultFacilityId,
  MANUAL_MOVEMENT_KINDS,
  StockError,
  type MovementKind,
} from "@/lib/repo/stock";
import { MANAGE_ROLES } from "@/lib/roles";

export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  return NextResponse.json({
    ok: true,
    movements: listMovements(guard.session.organizationId, {
      product_id: sp.get("product_id") ? Number(sp.get("product_id")) : undefined,
      facility_id: sp.get("facility_id") ? Number(sp.get("facility_id")) : undefined,
    }),
  });
}

export async function POST(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const body = (await req.json().catch(() => null)) as {
    product_id?: number;
    facility_id?: number | null;
    batch_id?: number | null;
    base_qty?: number;
    kind?: string;
    occurred_at?: string | null;
    notes?: string | null;
  } | null;

  if (
    !body?.product_id ||
    !Number.isFinite(body.base_qty) ||
    body.base_qty === 0 ||
    !MANUAL_MOVEMENT_KINDS.includes(body.kind as MovementKind)
  ) {
    return NextResponse.json(
      { ok: false, error: "کالا، مقدار غیر صفر و نوع حرکت مجاز لازم است" },
      { status: 400 }
    );
  }

  // Quantities in whole base units up to a billion and three decimals; a date that parses and is not
  // in the future; bounded notes. ±1e15, "zz" and a 100 KB note were all recorded.
  if (
    !isQuantity(body.base_qty, 1_000_000_000) ||
    (body.occurred_at != null && !isTimestampWithin(body.occurred_at, 5 * 366, 1)) ||
    (body.notes != null && boundedText(body.notes, 2000) === null)
  ) {
    return NextResponse.json({ ok: false, error: "مقدار، تاریخ یا یادداشت حرکت انبار معتبر نیست" }, { status: 400 });
  }

  try {
    const id = recordMovement(guard.session.organizationId, {
      facility_id: body.facility_id ?? defaultFacilityId(guard.session.organizationId),
      product_id: Number(body.product_id),
      batch_id: body.batch_id ?? null,
      base_qty: Number(body.base_qty),
      kind: body.kind as MovementKind,
      occurred_at: body.occurred_at ?? new Date().toISOString(),
      created_by: guard.session.user.id,
      notes: body.notes ?? null,
    });
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e) {
    if (e instanceof StockError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
