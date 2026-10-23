import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  advanceOrder,
  OrderTransitionError,
  OrderRoleError,
  OrderError,
} from "@/lib/repo/orders";
import type { OrderAction, OrderRole } from "@/lib/orderStateMachine";
import { NoWarehouseError } from "@/lib/repo/stock";

const ORDER_ROLES: OrderRole[] = ["phone_sales", "group_manager", "owner", "field_rep", "delivery_driver"];

/** Generic order transition. The transition table is the gate: an illegal (from, action)
 *  edge is 409 with the legal alternatives, a legal edge fired by the wrong role is 403,
 *  a missing / cross-tenant order is 404, and confirming with no warehouse to reserve from
 *  is 409 naming where to add one. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/sales/orders/[id]/transition">) {
  const guard = await requireRole(req, [
    "owner",
    "group_manager",
    "phone_sales",
    "field_rep",
    "delivery_driver",
  ]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    action?: string;
    reason_code_id?: number | null;
    note?: string | null;
    device_time?: string | null;
  } | null;
  if (!body?.action) {
    return NextResponse.json({ ok: false, error: "کنش مشخص نشده" }, { status: 400 });
  }

  const role = ORDER_ROLES.includes(guard.session.role as OrderRole)
    ? (guard.session.role as OrderRole)
    : ("phone_sales" as OrderRole);

  try {
    const to = await advanceOrder(
      guard.session.organizationId,
      Number(id),
      body.action as OrderAction,
      { id: guard.session.user.id, role },
      {
        reason_code_id: body.reason_code_id ?? null,
        note: body.note ?? null,
        device_time: body.device_time ?? null,
      }
    );
    return NextResponse.json({ ok: true, status: to });
  } catch (e) {
    if (e instanceof NoWarehouseError) {
      return NextResponse.json({ ok: false, error: "انبار تعریف نشده است؛ مالک آن را در «مکان‌های ما» تعریف کند." }, { status: 409 });
    }
    if (e instanceof OrderTransitionError) {
      return NextResponse.json({ ok: false, error: e.message, legal: e.legal }, { status: 409 });
    }
    if (e instanceof OrderRoleError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 403 });
    }
    if (e instanceof OrderError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 404 });
    }
    throw e;
  }
}
