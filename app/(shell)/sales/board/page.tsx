import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import OrderPipeline, { type PipelineOrder } from "@/components/sales/OrderPipeline";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const scope = orderFilter(session);
  const orders = readOrders(db, scope, { limit: 60 });

  // One query for the whole board rather than one per card.
  const onARun = new Set(
    (
      plain(
        db
          .prepare(
            `SELECT DISTINCT order_id FROM delivery_stops WHERE order_id IN (${
              orders.map(() => "?").join(",") || "NULL"
            })`
          )
          .all(...orders.map((o) => o.id))
      ) as unknown as { order_id: number }[]
    ).map((r) => r.order_id)
  );

  const board: PipelineOrder[] = orders.map((o) => ({
    id: o.id,
    order_no: o.order_no,
    customer_name: o.customer_name,
    salesperson_name: o.salesperson_name,
    status: o.status,
    order_date: o.order_date,
    total_toman: o.total_toman,
    paid_toman: o.paid_toman,
    payment_status: o.payment_status,
    kg: o.kg,
    line_count: o.line_count,
    on_run: onARun.has(o.id),
  }));

  return (
    <div className="kblock">
      <div className="bhead">
        <div>
          <h2>خط سفارش‌ها</h2>
          <div className="n">
            کارت را بکشید تا مرحله‌اش عوض شود · روی کارت بزنید تا پردازش شود
          </div>
        </div>
      </div>
      <div className="hint">
        <b>روی موبایل:</b> انگشت را روی کارت نگه دارید و بکشید — همان کار را می‌کند.
      </div>
      <OrderPipeline orders={board} />
    </div>
  );
}
