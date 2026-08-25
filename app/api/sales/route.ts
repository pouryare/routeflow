import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireRole } from "@/lib/session";

// Owner only, per the Phase 0 plan's role table. sales rows are keyed by customer_name
// and carry no group of their own, so there is nothing to scope them by yet; until
// there is, the safe reading of "unscoped" is "owner only".
export async function GET(req: NextRequest) {
  const guard = requireRole(req, ["owner"]);
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(req.url);
  const customer = searchParams.get("customer");
  if (!customer) {
    return NextResponse.json({ ok: false, error: "نام مشتری وارد نشده است" }, { status: 400 });
  }

  const db = getDb();
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
