import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import {
  getPayment,
  allocationsOfPayment,
  voidPayment,
  PaymentError,
} from "@/lib/repo/payments";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/payments/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager", "phone_sales"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const payment = getPayment(guard.session.organizationId, Number(id));
  if (!payment) return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    payment,
    allocations: allocationsOfPayment(guard.session.organizationId, Number(id)),
  });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/payments/[id]">) {
  const guard = requireRole(req, ["owner", "group_manager"]);
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
