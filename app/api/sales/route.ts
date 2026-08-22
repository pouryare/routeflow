import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
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
