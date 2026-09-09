import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import { readJourney, buildJourney } from "@/lib/orderJourney";
import { faNum, faToman } from "@/lib/format";
import OrderJourney from "@/components/sales/OrderJourney";
import { faJalaliDate } from "@/lib/jalali";
import PageHeader from "@/components/meridian/PageHeader";

export const dynamic = "force-dynamic";

/** A query parameter may arrive repeated («?order=1&order=2»), in which case Next hands
 *  over an array. Taking the first beats letting `Number([..])` quietly produce NaN. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function JourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const db = getDb();
  const scope = orderFilter(session);
  const orders = readOrders(db, scope, { limit: 60 });

  const asked = one((await searchParams).order);
  const wanted = asked !== undefined && /^\d+$/.test(asked) ? Number(asked) : undefined;
  /* Chosen from the list this session can already see, so the journey cannot be used to
     probe for an order in another group by its id -- the scope decision stays in
     orderFilter and is not re-derived here. */
  const focus = orders.find((o) => o.id === wanted) ?? orders[0];
  const journey = focus ? readJourney(db, focus.id) : null;

  const STATUS: Record<string, string> = {
    draft: "پیش‌نویس",
    confirmed: "تأییدشده",
    delivered: "تحویل‌شده",
    cancelled: "لغوشده",
  };
  const PAY: Record<string, string> = {
    unpaid: "پرداخت‌نشده",
    partial: "بخشی پرداخت‌شده",
    paid: "تسویه‌شده",
  };

  const nodes = journey ? buildJourney(journey) : [];
  const current = nodes.find((n) => n.state === "current");

  return (
    <>
    <PageHeader route="/sales/journey" />
    <div className="kblock">
      <div className="bhead">
        <div>
          <h2>مسیر سفارش</h2>
          <div className="n">
            {focus
              ? "یک سفارش از لحظهٔ ثبت تا لحظهٔ تسویه — هر مرحله از روی همان چیزی خوانده می‌شود که ثبت شده، نه از روی یک تیک دستی."
              : "هنوز سفارشی برای نمایش نیست."}
          </div>
        </div>
        {focus && (
          <div className="acts">
            <Link className="btn ghost" href={`/sales/orders/${focus.id}`}>
              صفحهٔ سفارش
            </Link>
          </div>
        )}
      </div>

      {orders.length > 0 && (
        <div className="picker">
          <span className="picker__label">سفارش:</span>
          <div className="picker__row">
            {orders.slice(0, 12).map((o) => (
              <Link
                key={o.id}
                href={`/sales/journey?order=${o.id}`}
                className={`picker__chip${o.id === focus?.id ? " on" : ""}`}
              >
                <span className="mono">{faNum(Number(o.order_no.split("-")[1] ?? 0))}#</span>
                <span className="picker__who">{o.customer_name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {focus && journey ? (
        <>
          {/* What this order IS, before how far along it is. Without it the four lanes
              describe a process with no subject. */}
          <dl className="jsum">
            <div><dt>مشتری</dt><dd>{focus.customer_name}</dd></div>
            <div><dt>مبلغ</dt><dd className="mono">{faToman(focus.total_toman)}</dd></div>
            <div><dt>وزن</dt><dd className="mono">{faNum(focus.kg)} کیلو</dd></div>
            <div><dt>تاریخ ثبت</dt><dd className="mono">{faJalaliDate(focus.order_date)}</dd></div>
            <div><dt>وضعیت</dt><dd>{STATUS[focus.status] ?? focus.status}</dd></div>
            <div><dt>پرداخت</dt><dd>{PAY[focus.payment_status] ?? focus.payment_status}</dd></div>
          </dl>

          <p className="jnow">
            {current ? (
              <>
                این سفارش الان روی مرحلهٔ <b>{current.label}</b> است — {current.note}
              </>
            ) : (
              <>این سفارش کامل شده: تحویل داده و تسویه شده است.</>
            )}
          </p>

          <div className="lanes">
            <OrderJourney nodes={nodes} />
          </div>
        </>
      ) : (
        <p style={{ padding: "0 24px 28px", color: "var(--muted)", fontSize: 13.5 }}>
          هنوز سفارشی برای نمایش مسیرش ثبت نشده است.
        </p>
      )}
    </div>    </>
  );
}
