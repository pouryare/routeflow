import { NextRequest, NextResponse } from "next/server";
import { requireRole, orderFilter, canReachGroup } from "@/lib/session";
import { ordersIn } from "@/lib/repo/routeAdapters";
import { listPayments, customerDebt } from "@/lib/repo/payments";
import { getScopedCustomer } from "@/lib/repo/customers";
import { MANAGE_ROLES } from "@/lib/roles";

/** One customer's money in one read: their orders, their payments and the aged
 *  balance behind the debt pill. Scoped -- a salesperson sees only a customer in
 *  their own territory; anyone else's customer reads as not found. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/customers/[id]/statement">) {
  const guard = requireRole(req, [...MANAGE_ROLES, "phone_sales"]);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const customerId = Number(id);

  const customer = getScopedCustomer(guard.session.organizationId, customerId);
  if (!customer || !canReachGroup(guard.session, customer.group_id)) {
    return NextResponse.json({ ok: false, error: "یافت نشد" }, { status: 404 });
  }

  const orders = ordersIn(orderFilter(guard.session), { customerId });
  const payments = listPayments(guard.session.organizationId, { customer_id: customerId });
  const debt = customerDebt(guard.session.organizationId, customerId);

  return NextResponse.json({
    ok: true,
    customer: { id: customer.id, business_name: customer.business_name },
    orders,
    payments,
    debt,
  });
}
