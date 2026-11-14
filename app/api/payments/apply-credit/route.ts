import { NextRequest, NextResponse } from "next/server";
import { canReachGroup, requireRole } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { isId } from "@/lib/inputChecks";
import { PaymentError, customerGroupOf } from "@/lib/repo/payments";
import { applyCreditToOrder, orderCustomer } from "@/lib/repo/onAccount";

/** F63: put a customer's on-account credit on one order { order_id }. Same roles as recording a payment. */
export async function POST(req: NextRequest) {
  const guard = await requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;
  const b = (await req.json().catch(() => null)) as { order_id?: unknown } | null;
  const orderId = String(b?.order_id ?? "");
  if (!isId(orderId)) return NextResponse.json({ ok: false, error: "درخواست نامعتبر است" }, { status: 400 });
  const org = guard.session.organizationId;
  const o = (await orderCustomer(org, Number(orderId)));
  const cust = o ? await customerGroupOf(org, Number(o.customer_id)) : undefined;
  if (!o || !cust || (cust.group_id !== null && !(await canReachGroup(guard.session, cust.group_id)))) return NextResponse.json({ ok: false, error: "سفارش پیدا نشد" }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, applied: await applyCreditToOrder(org, Number(orderId)) });
  } catch (e) {
    if (e instanceof PaymentError) return NextResponse.json({ ok: false, error: e.message }, { status: 400 });
    throw e;
  }
}
