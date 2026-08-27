import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter, groupFilter } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import OrderPocketCard, { OrderDoc } from "@/components/sales/OrderPocketCard";
import Reveal from "@/components/kargah/Reveal";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  confirmed: "تأییدشده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};

const STATUS_TONE: Record<string, string> = {
  draft: "var(--text-muted)",
  confirmed: "var(--accent)",
  delivered: "var(--good)",
  cancelled: "var(--crit)",
};

const PAYMENT_LABEL: Record<string, string> = {
  unpaid: "پرداخت‌نشده",
  partial: "بخشی",
  paid: "پرداخت‌شده",
};

/** A query parameter may arrive repeated («?customer=1&customer=2»), in which case Next
 *  hands over an array. Taking the first is enough here and beats letting `Number([..])`
 *  quietly produce NaN. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const raw = one((await searchParams).customer);
  const customerId = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : undefined;

  // Named separately from the orders, so the chip still says whose list this is when the
  // answer is "none yet" -- which is the commonest case for a shop that has never
  // ordered, and exactly when the reader most needs telling why the page is empty.
  const scope = groupFilter(session);
  const focused =
    customerId === undefined
      ? null
      : (db
          .prepare(`SELECT id, business_name FROM customers WHERE id = ?${scope.sql}`)
          .get(customerId, ...scope.params) as { id: number; business_name: string } | undefined) ??
        null;

  const orders = readOrders(db, orderFilter(session), {
    limit: 100,
    customerId: focused?.id,
  });

  // Which of these orders are already loaded onto a van. One query for the whole page
  // rather than one per row -- the list renders up to 200 orders.
  const onARun = new Set(
    (
      plain(
        db
          .prepare(
            `SELECT DISTINCT order_id FROM delivery_stops WHERE order_id IN (${orders
              .map(() => "?")
              .join(",") || "NULL"})`
          )
          .all(...orders.map((o) => o.id))
      ) as unknown as { order_id: number }[]
    ).map((r) => r.order_id)
  );

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-3)]">
        <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">
          {orders.length === 0
            ? "سفارشی پیدا نشد"
            : `${faNum(orders.length)} سفارش${focused ? "" : " اخیر"}`}
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
            href={focused ? `/sales/orders/new?customer=${focused.id}` : "/sales/orders/new"}
            className="rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--accent)] px-[var(--space-4)] py-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-accent-ink no-underline transition-[filter] duration-[var(--dur-base)] hover:brightness-110"
          >
            ثبت سفارش تازه
          </Link>
        </div>
      </div>

      {focused && (
        <div className="flex flex-wrap items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--surface-2)] px-[var(--space-3)] py-[var(--space-2)]">
          <span className="text-[length:var(--text-sm)] text-[var(--text-muted)]">
            فقط سفارش‌های <strong className="font-medium text-[var(--text)]">{focused.business_name}</strong>
          </span>
          <Link
            href="/sales/orders"
            className="text-[length:var(--text-xs)] text-[var(--accent)] no-underline hover:brightness-110"
          >
            نمایش همه ✕
          </Link>
        </div>
      )}

      {orders.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] leading-7 text-[var(--text-muted)]">
          {focused
            ? `برای ${focused.business_name} هنوز سفارشی ثبت نشده است.`
            : "اولین سفارش را ثبت کنید. از همان لحظه، بدهی و تاریخ آخرین خرید مشتری‌ها روی نقشه هم به‌روز می‌شود."}
        </p>
      ) : (
        <Reveal replayKey={String(focused?.id ?? "all")} select="li">
          <ul className="flex list-none flex-col gap-[var(--space-4)] p-0 pt-[var(--space-2)]">
            {orders.map((order) => (
              <li key={order.id}>
                <OrderPocketCard
                  href={`/sales/orders/${order.id}`}
                  tone={STATUS_TONE[order.status] ?? "var(--neutral)"}
                  docs={
                    [
                      // A draft has not been invoiced, so there is no receipt to file.
                      order.status !== "draft" && "receipt",
                      onARun.has(order.id) && "delivery",
                    ].filter(Boolean) as OrderDoc[]
                  }
                  /* Each paper prints the figure that document is actually about, so
                     pulling the fan open answers a question rather than showing a prop. */
                  docNote={{
                    receipt: faToman(order.total_toman),
                    delivery: `${faNum(order.kg)} کیلو`,
                  }}
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
                </OrderPocketCard>
              </li>
            ))}
          </ul>
        </Reveal>
      )}
    </div>
  );
}
