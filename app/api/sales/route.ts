import { NextRequest, NextResponse } from "next/server";
import { groupFilter, orgScopeId, requireRole } from "@/lib/session";
import { customerNameVisible, customerPurchaseHistory } from "@/lib/repo/customerSales";
import { MANAGE_ROLES } from "@/lib/roles";

// A manager may read the purchase history of their own customers -- it is what the
// customer detail panel shows, and a manager who cannot see it cannot do their job.
//
// sales rows are keyed by customer_name and carry no group of their own, so the scope
// comes from the customers table: the named customer has to be one this caller can
// already see. Widening the role without that check would have been the leak, since any
// business name is guessable and the ledger is the whole debt picture.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, MANAGE_ROLES);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const customer = searchParams.get("customer");
  if (!customer) {
    return NextResponse.json({ ok: false, error: "نام مشتری وارد نشده است" }, { status: 400 });
  }

  // 404, not 403: the same rule as everywhere else -- a 403 would confirm that a customer
  // by this name exists in someone else's group.
  if (!customerNameVisible(customer, groupFilter(guard.session))) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  }

  const { orders, topProducts } = customerPurchaseHistory(customer, orgScopeId(guard.session));

  return NextResponse.json({ ok: true, orders, topProducts });
}
