import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  getPayment,
  allocationsOfPayment,
  deliveredOrdersForCustomer,
  replaceAllocations,
  voidPayment,
  PaymentError,
} from "@/lib/repo/payments";
import { MANAGE_ROLES } from "@/lib/roles";
import { getDb } from "@/lib/db";

/** deliveredOrdersForCustomer takes an explicit handle rather than importing one. */
const paymentsDb = getDb;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/payments/[id]">) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const payment = getPayment(guard.session.organizationId, Number(id));
  if (!payment) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    payment,
    allocations: allocationsOfPayment(guard.session.organizationId, Number(id)),
    /* The customer's open orders, so the allocation picker has something to offer. Sent
       with the payment rather than as its own endpoint: the editor always needs both, and
       two round trips that could disagree about the payment's customer are worse than one. */
    openOrders: deliveredOrdersForCustomer(
      paymentsDb(),
      guard.session.organizationId,
      payment.customer_id
    ),
  });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/payments/[id]">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const paymentId = Number(id);
  if (!getPayment(guard.session.organizationId, paymentId)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as {
    allocations?: { order_id: number | null; amount_toman: number }[];
  } | null;
  if (!body?.allocations) {
    return NextResponse.json({ ok: false, error: "تخصیص‌ها لازم است" }, { status: 400 });
  }

  try {
    // The repo re-reads the payment under its own organization scope, so a hand-crafted id
    // from another tenant still fails there rather than only here.
    replaceAllocations(guard.session.organizationId, paymentId, body.allocations);
    return NextResponse.json({
      ok: true,
      allocations: allocationsOfPayment(guard.session.organizationId, paymentId),
    });
  } catch (e) {
    if (e instanceof PaymentError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/payments/[id]">) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  if (req.nextUrl.searchParams.get("action") !== "void") {
    return NextResponse.json({ ok: false, error: "کنش نامعتبر است" }, { status: 400 });
  }
  const body = (await req.json().catch(() => null)) as { reason?: string } | null;
  if (!body?.reason) {
    return NextResponse.json({ ok: false, error: "دلیل ابطال لازم است" }, { status: 400 });
  }

  // A payment in another org reads as not found -- but we only learn that from the
  // repo, which throws the same PaymentError for "gone" and "already void". Check
  // existence first so a genuine 404 is not reported as 409.
  if (!getPayment(guard.session.organizationId, Number(id))) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  try {
    voidPayment(guard.session.organizationId, Number(id), guard.session.user.id, body.reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof PaymentError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: 409 });
    }
    throw e;
  }
}
