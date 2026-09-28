import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readOrders } from "@/lib/orders";
import { readJourney, buildJourney } from "@/lib/orderJourney";
import { eventsByStep } from "@/lib/orderEvents";
import { buildFunnel } from "@/lib/orderFunnel";
import { readOrderEvents, readFunnelRows } from "@/lib/repo/journey";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orderStateMachine";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import OrderSpine from "@/components/sales/OrderSpine";
import OrderFunnel from "@/components/sales/OrderFunnel";
import PageHeader from "@/components/meridian/PageHeader";
import { isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** A query parameter may arrive repeated («?order=1&order=2»), in which case Next hands
 *  over an array. Taking the first beats letting `Number([..])` quietly produce NaN. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** /sales/journey, in two modes (item 7, spec D5).
 *
 *  «این سفارش»: one order's life as a vertical spine with an icon per milestone and the
 *  status log under each. «همه سفارش‌ها»: a funnel of every order the viewer can see,
 *  with the drop-off and the stall at each stage. They answer different questions ("what
 *  happened to this one" and "where do they get stuck"), which is what earns the switch.
 *  The mode lives in the URL (`?view=all`) so it survives a reload and can be linked. */
export default async function JourneyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const db = getDb();
  const scope = orderFilter(session);
  const orders = readOrders(db, scope, { limit: 60 });

  const params = await searchParams;
  const mode = one(params.view) === "all" ? "all" : "one";
  const asked = one(params.order);
  const wanted = asked !== undefined && /^\d+$/.test(asked) ? Number(asked) : undefined;
  /* Chosen from the list this session can already see, so the journey cannot be used to
     probe for an order in another group by its id -- the scope decision stays in
     orderFilter and is not re-derived here. */
  const focus = orders.find((o) => o.id === wanted) ?? orders[0];
  const journey = mode === "one" && focus ? readJourney(db, focus.id) : null;
  const nodes = journey ? buildJourney(journey) : [];
  const current = nodes.find((n) => n.state === "current");
  const events = journey && focus ? eventsByStep(readOrderEvents(db, focus.id)) : null;
  /* The same scope as the list above: the funnel cannot count an order the list hides. */
  const funnel = mode === "all" ? buildFunnel(readFunnelRows(db, scope)) : null;
  const keep = focus ? `&order=${focus.id}` : "";

  return (
    <>
      <PageHeader route="/sales/journey" />
      <div className="kblock">
        <div className="bhead">
          <div>
            <h2>{mode === "all" ? "همهٔ سفارش‌ها" : "پیگیری سفارش"}</h2>
            <div className="n">
              {mode === "all"
                ? "هر سفارش تا کجا رسیده و کجا مانده — برای همهٔ سفارش‌هایی که می‌بینید."
                : focus
                  ? "یک سفارش از لحظهٔ ثبت تا لحظهٔ تسویه — هر مرحله از روی همان چیزی خوانده می‌شود که ثبت شده، نه از روی یک تیک دستی."
                  : "هنوز سفارشی برای نمایش نیست."}
            </div>
          </div>
          <div className="acts">
            <nav className="jmode" aria-label="نمای مسیر">
              <Link
                className={`btn ${mode === "one" ? "solid" : "ghost"}`}
                aria-current={mode === "one" ? "page" : undefined}
                href={`/sales/journey?view=one${keep}`}
              >
                این سفارش
              </Link>
              <Link
                className={`btn ${mode === "all" ? "solid" : "ghost"}`}
                aria-current={mode === "all" ? "page" : undefined}
                href={`/sales/journey?view=all${keep}`}
              >
                همهٔ سفارش‌ها
              </Link>
            </nav>
            {mode === "one" && focus ? (
              <Link className="btn ghost" href={`/sales/orders/${focus.id}`}>
                صفحهٔ سفارش
              </Link>
            ) : null}
          </div>
        </div>

        {mode === "all" && funnel ? (
          <div className="kblock__body">
            <OrderFunnel stages={funnel} />
          </div>
        ) : (
          <>
            {orders.length > 0 && (
              <div className="picker">
                <span className="picker__label">سفارش:</span>
                <div className="picker__row">
                  {orders.slice(0, 12).map((o) => (
                    <Link
                      key={o.id}
                      href={`/sales/journey?view=one&order=${o.id}`}
                      className={`picker__chip${o.id === focus?.id ? " on" : ""}`}
                    >
                      <span className="mono">{faNum(Number(o.order_no.split("-")[1] ?? 0))}#</span>
                      <span className="picker__who">{o.customer_name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {focus && journey && events ? (
              <>
                {/* What this order IS, before how far along it is. Without it the spine
                    describes a process with no subject. */}
                <dl className="jsum">
                  <div><dt>مشتری</dt><dd>{focus.customer_name}</dd></div>
                  <div><dt>مبلغ</dt><dd className="mono">{faToman(focus.total_toman)}</dd></div>
                  <div><dt>وزن</dt><dd className="mono">{faNum(focus.kg)} کیلو</dd></div>
                  <div><dt>تاریخ ثبت</dt><dd className="mono">{faJalaliDate(focus.order_date)}</dd></div>
                  <div><dt>وضعیت</dt><dd>{ORDER_STATUS_LABEL[focus.status as OrderStatus] ?? "نامشخص"}</dd></div>
                  <div><dt>پرداخت</dt><dd>{PAYMENT_STATUS_LABEL[focus.payment_status as PaymentStatus] ?? "نامشخص"}</dd></div>
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

                <div className="kblock__body">
                  <OrderSpine nodes={nodes} events={events} />
                </div>
              </>
            ) : (
              <p className="kblock__body" style={{ color: "var(--muted)", fontSize: 13.5 }}>
                هنوز سفارشی برای نمایش مسیرش ثبت نشده است.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
