import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { groupFilter, requireRole } from "@/lib/session";

// A manager may read the purchase history of their own customers -- it is what the
// customer detail panel shows, and a manager who cannot see it cannot do their job.
//
// sales rows are keyed by customer_name and carry no group of their own, so the scope
// comes from the customers table: the named customer has to be one this caller can
// already see. Widening the role without that check would have been the leak, since any
// business name is guessable and the ledger is the whole debt picture.
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner", "group_manager"]);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const customer = searchParams.get("customer");
  if (!customer) {
    return NextResponse.json({ ok: false, error: "نام مشتری وارد نشده است" }, { status: 400 });
  }

  const db = getDb();
  const filter = groupFilter(guard.session);
  const reachable = db
    .prepare(`SELECT 1 FROM customers WHERE business_name = ?${filter.sql} LIMIT 1`)
    .get(customer, ...filter.params);
  // 404, not 403: the same rule as everywhere else -- a 403 would confirm that a customer
  // by this name exists in someone else's group.
  if (!reachable) {
    return NextResponse.json({ ok: false, error: "مشتری پیدا نشد" }, { status: 404 });
  }

  const orders = db
    .prepare(
      `SELECT order_no, sale_date, product_name, qty, amount, payment_status, shipping_status
       FROM sales WHERE customer_name = ? ORDER BY sale_date DESC, id DESC LIMIT 50`
    )
    .all(customer);

  const topProducts = db
    .prepare(
      `SELECT product_name, SUM(amount) as total_amount, COUNT(*) as line_count
       FROM sales WHERE customer_name = ? AND product_name IS NOT NULL
       GROUP BY product_name ORDER BY total_amount DESC LIMIT 5`
    )
    .all(customer);

  return NextResponse.json({ ok: true, orders, topProducts });
}
