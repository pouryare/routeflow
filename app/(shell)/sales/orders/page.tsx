import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, type Session } from "@/lib/session";
import { ordersListFor, journeyFor } from "@/lib/repo/ordersView";
import type { OrderSummary } from "@/lib/orders";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { PocketDoc, PocketStatus } from "@/components/meridian/PocketCard";
import OrdersPockets, { type PocketRow } from "@/components/meridian/OrdersPockets";
import OrderPipeline, { type PipelineOrder } from "@/components/sales/OrderPipeline";
import OrderSpine from "@/components/sales/OrderSpine";
import OrderFunnel from "@/components/sales/OrderFunnel";
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orderStateMachine";
import { statusLabel, isPreConfirm, isFulfilled } from "@/components/sales/orderStage";
import PageHeader from "@/components/meridian/PageHeader";
import ViewTabs, { type ViewTab } from "@/components/meridian/ViewTabs";
import { oneOf, one, type SearchParams } from "@/lib/viewParam";
import { canSell, isVanRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The three ways to read the same orders, selected by `?view=`.
 *
 *  `""` is the default: the pocket list, which is what this route has always shown. The
 *  other two were their own routes over their own `readOrders` call at a lower limit. One
 *  table, one reader, one limit, three lenses. */
const VIEWS = ["", "board", "journey"] as const;
type OrdersView = (typeof VIEWS)[number];

const VIEW_TABS: ViewTab[] = [
  { value: "", label: "فهرست", route: "/sales/orders" },
  { value: "board", label: "تابلو", route: "/sales/orders" },
  { value: "journey", label: "پیگیری", route: "/sales/orders" },
];

/** Map the 14-state machine onto the card's three pills. */
function statusPill(status: string): { pill: PocketStatus; label: string } {
  const pill: PocketStatus = isFulfilled(status)
    ? "done"
    : isPreConfirm(status) || status === "CANCELLED"
      ? "draft"
      : "conf";
  return { pill, label: statusLabel(status) };
}

/* The artifact's own document tones, kept as literal pairs: strong, then its pale echo. */
const TONE = {
  sage: ["#4F6B4A", "#C7D6C3"] as [string, string],
  accent: ["#C0532B", "#EFC9B8"] as [string, string],
  amber: ["#9A6B10", "#EBD9B2"] as [string, string],
  sky: ["#2E6382", "#BCD5E2"] as [string, string],
  plum: ["#6B4FA0", "#D6CBE9"] as [string, string],
};

/** Four bar heights derived from the order itself.
 *
 *  Deterministic on purpose: a card whose little chart redraws differently on every
 *  render is decoration pretending to be data. These come from the id and the figure, so
 *  the same order always draws the same bars.
 */
function barsFor(seed: number, total: number): [number, number, number, number] {
  const out: number[] = [];
  let x = (seed * 2654435761 + total) >>> 0;
  for (let i = 0; i < 4; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out.push(0.35 + ((x >>> 16) % 66) / 100);
  }
  return out as [number, number, number, number];
}

/** «فهرست» — the pocket list, which is what this route always showed. */
function ListView({
  orders,
  onARun,
  focused,
  mayOrder,
}: {
  orders: OrderSummary[];
  onARun: Set<number>;
  focused: { id: number; business_name: string } | null;
  /** canSell: a rep manager reads this list but the order API refuses their sale. */
  mayOrder: boolean;
}) {
  const customerCount = new Set(orders.map((o) => o.customer_name)).size;
  return (
    <div className="kblock">
      <div className="bhead">
        <div>
          <h2>{focused ? `سفارش‌های ${focused.business_name}` : "سفارش‌های اخیر"}</h2>
          <div className="n">
            {orders.length === 0
              ? "سفارشی پیدا نشد"
              : `${faNum(orders.length)} سفارش، از ${faNum(customerCount)} مشتری · روی هر کارت بزنید`}
          </div>
        </div>
        <div className="acts">
          {orders.length > 0 && (
            /* A plain anchor with `download`, on purpose: this is a file, not a
               navigation, and next/link would attempt a client-side transition to a
               route that answers with an .xlsx. */
            <a className="btn ghost" href="/api/sales/orders/export" download>
              خروجی اکسل
            </a>
          )}
          {mayOrder && (
            <Link
              className="btn solid"
              href={focused ? `/sales/orders/new?customer=${focused.id}` : "/sales/orders/new"}
            >
              ＋ ثبت سفارش تازه
            </Link>
          )}
        </div>
      </div>

      {orders.length === 0 ? (
        <p style={{ padding: "0 24px 28px", color: "var(--muted)", fontSize: 13.5 }}>
          {focused
            ? `برای ${focused.business_name} هنوز سفارشی ثبت نشده است.`
            : "اولین سفارش را ثبت کنید. از همان لحظه، بدهی و تاریخ آخرین خرید مشتری‌ها روی نقشه هم به‌روز می‌شود."}
        </p>
      ) : (
        <OrdersPockets
          rows={orders.map((order): PocketRow => {
            const st = statusPill(order.status);
            const docs: PocketDoc[] = [];
            // A draft has not been invoiced, so there is no receipt to file.
            if (!isPreConfirm(order.status)) {
              docs.push({
                label: "رسید تحویل",
                value: faNum(order.total_toman),
                tone: isFulfilled(order.status) ? TONE.sage : TONE.amber,
                bars: barsFor(order.id, order.total_toman),
              });
            }
            if (onARun.has(order.id)) {
              docs.push({
                label: "برگهٔ مسیر",
                value: `${faNum(order.kg)} کیلو`,
                tone: TONE.sky,
                bars: barsFor(order.id + 7, Math.round(order.kg)),
              });
            } else if (isPreConfirm(order.status)) {
              docs.push({
                label: "پیش‌فاکتور",
                value: faNum(order.total_toman),
                tone: TONE.accent,
                bars: barsFor(order.id + 3, order.total_toman),
              });
            }
            return {
              id: order.id,
              href: `/sales/orders/${order.id}`,
              customerId: order.customer_id,
              customer: order.customer_name,
              meta: `${faNum(Number(order.order_no.split("-")[1]))}# · ${faJalaliDate(order.order_date)}${
                order.salesperson_name ? ` · ${order.salesperson_name}` : ""
              }`,
              amount: faNum(order.total_toman),
              status: st.pill,
              statusLabel: st.label,
              docs,
            };
          })}
        />
      )}
    </div>
  );
}

/** «تابلو» — the stage pipeline, which was /sales/board.
 *
 *  Same orders as the list, read once. What changed is that they come from the host's
 *  single readOrders at limit 100 rather than this page's own, truncated to 60. */
function BoardView({ orders, onARun }: { orders: OrderSummary[]; onARun: Set<number> }) {
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

/** «پیگیری» — one order's life, or the funnel of them all. Which was /sales/journey.
 *
 *  A server function, so it cannot read search params itself: `mode` and `askedOrderId`
 *  come in as props from the host. The mode that page called `one`/`all` survives as
 *  `?mode=all` on the host — a DIFFERENT key from the host's own `?view=`, so
 *  `oneOf(params, VIEWS, "")` still resolves the outer view. Two params both called
 *  `view` would collide, and the reader takes the first, silently losing the mode. */
async function JourneyView({
  session,
  orders,
  mode,
  askedOrderId,
}: {
  session: Session;
  orders: OrderSummary[];
  mode: "one" | "all";
  askedOrderId: number | undefined;
}) {
  /* The journey and the funnel are chosen from, and scoped like, the list this session can
     already see (see journeyFor), so neither can be used to probe for an order it hides. */
  const { focus, journey, nodes, events, funnel } = await journeyFor(session, orders, mode, askedOrderId);
  const current = nodes.find((n) => n.state === "current");
  const keep = focus ? `&order=${focus.id}` : "";

  return (
    <div className="kblock">
      <div className="bhead">
        <div>
          <h2>{mode === "all" ? "همهٔ سفارش‌ها" : "پیگیری سفارش"}</h2>
          <div className="n">
            {mode === "all"
              ? "هر سفارشی که می‌بینید، و اینکه کجا متوقف شده است"
              : "مسیر کامل یک سفارش، از ثبت تا تسویه"}
          </div>
        </div>
        <div className="acts">
          <nav className="jmode" aria-label="نمای مسیر">
            <Link
              className={`btn ${mode === "one" ? "solid" : "ghost"}`}
              aria-current={mode === "one" ? "page" : undefined}
              href={`/sales/orders?view=journey${keep}`}
            >
              این سفارش
            </Link>
            <Link
              className={`btn ${mode === "all" ? "solid" : "ghost"}`}
              aria-current={mode === "all" ? "page" : undefined}
              href={`/sales/orders?view=journey&mode=all${keep}`}
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
                    href={`/sales/orders?view=journey&order=${o.id}`}
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
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const params = (await searchParams) as SearchParams;
  const view: OrdersView = oneOf(params, VIEWS, "");
  const customerParam = one(params, "customer");
  const orderParam = one(params, "order");
  const customerId = customerParam !== undefined && /^\d+$/.test(customerParam) ? Number(customerParam) : undefined;

  const { focused, orders, onARun } = await ordersListFor(session, { customerId });

  const mode = one(params, "mode") === "all" ? "all" : "one";
  const askedOrderId = orderParam !== undefined && /^\d+$/.test(orderParam) ? Number(orderParam) : undefined;

  return (
    <>
      <PageHeader route="/sales/orders" />
      <ViewTabs tabs={VIEW_TABS} current={view} />
      {view === "board" ? (
        <BoardView orders={orders} onARun={onARun} />
      ) : view === "journey" ? (
        <JourneyView session={session} orders={orders} mode={mode} askedOrderId={askedOrderId} />
      ) : (
        <ListView orders={orders} onARun={onARun} focused={focused} mayOrder={canSell(session.role)} />
      )}
    </>
  );
}
