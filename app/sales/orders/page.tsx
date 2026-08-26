import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  confirmed: "تأییدشده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};

const STATUS_TONE: Record<string, string> = {
  draft: "var(--text-faint)",
  confirmed: "var(--accent)",
  delivered: "var(--good)",
  cancelled: "var(--crit)",
};

const PAYMENT_LABEL: Record<string, string> = {
  unpaid: "پرداخت‌نشده",
  partial: "بخشی",
  paid: "پرداخت‌شده",
};

export default async function OrdersPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const orders = readOrders(getDb(), orderFilter(session), { limit: 100 });

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          {orders.length === 0
            ? "هنوز سفارشی ثبت نشده"
            : `${faNum(orders.length)} سفارش اخیر`}
        </p>
        <div className="flex items-center gap-[var(--space-2)]">
          {orders.length > 0 && (
            /* A plain anchor with `download`, on purpose. This is a file, not a
               navigation: next/link would attempt a client-side route transition to a
               route that answers with an .xlsx, which is not a page and cannot render. */
            <a
              href="/api/sales/orders/export"
              download
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline transition-colors duration-[var(--dur-base)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              خروجی اکسل
            </a>
          )}
          <Link
            href="/sales/orders/new"
            className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-[#04191c] no-underline transition-[filter] duration-[var(--dur-base)] hover:brightness-110"
          >
            ثبت سفارش تازه
          </Link>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] leading-7 text-[var(--text-faint)]">
          اولین سفارش را ثبت کنید. از همان لحظه، بدهی و تاریخ آخرین خرید مشتری‌ها روی
          نقشه هم به‌روز می‌شود.
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-[var(--space-2)] p-0">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/sales/orders/${order.id}`}
                className="block rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] no-underline transition-colors duration-[var(--dur-base)] hover:border-[var(--border-strong)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                  <span className="text-[length:var(--text-base)] text-[var(--text)]">
                    {order.customer_name}
                  </span>
                  <span className="tabular-nums text-[length:var(--text-base)] text-[var(--text)]">
                    {faToman(order.total_toman)}
                  </span>
                </div>

                <div className="mt-[var(--space-2)] flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  <span className="tabular-nums">{faNum(Number(order.order_no.split("-")[1]))}#</span>
                  <span>{faJalaliDate(order.order_date)}</span>
                  <span style={{ color: STATUS_TONE[order.status] }}>
                    {STATUS_LABEL[order.status] ?? order.status}
                  </span>
                  <span>{PAYMENT_LABEL[order.payment_status] ?? order.payment_status}</span>
                  <span className="tabular-nums">{faNum(order.kg)} کیلو</span>
                  {order.salesperson_name && <span>{order.salesperson_name}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
