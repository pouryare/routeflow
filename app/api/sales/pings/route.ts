import { NextRequest, NextResponse } from "next/server";
import { requireRole, orderFilter } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { ordersIn } from "@/lib/repo/routeAdapters";
import { pingsAfter } from "@/lib/salePings";

/** «سفارش تازه»: the sales summary asks this every few seconds while it is on screen, so a
 *  manager or owner sees an order land without reloading. Same scope as the order list
 *  (`orderFilter`), so nobody is pinged about an order they could not open. */
export async function GET(req: NextRequest) {
  const guard = await requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const raw = new URL(req.url).searchParams.get("after");
  const after = raw === null || !Number.isFinite(Number(raw)) ? null : Number(raw);

  const orders = await ordersIn(orderFilter(guard.session), { limit: 20 });
  return NextResponse.json({
    ok: true,
    ...pingsAfter(
      orders.map((o) => ({ id: o.id, order_no: o.order_no, customer_name: o.customer_name, total_toman: o.total_toman })),
      after,
    ),
  });
}
