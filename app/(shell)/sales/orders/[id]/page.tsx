import CardTable from "@/components/CardTable";
import BooksButton from "@/components/accounting/BooksButton";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { orderPageFor } from "@/lib/repo/ordersView";
import { pageMetadata } from "@/lib/pageMeta";
import type { Metadata } from "next";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, faJalaliDateTime } from "@/lib/jalali";
import { buildMapLink } from "@/lib/deepLink";
import ConfirmOrderButton from "@/components/sales/ConfirmOrderButton";
import OrderStatusPanel from "@/components/sales/OrderStatusPanel";
import { statusLabel } from "@/components/sales/orderStage";
import type { OrderRole } from "@/lib/orderStateMachine";
import BentoStrip, {
  BentoIdentity,
  BentoTile,
  BentoGauge,
} from "@/components/BentoStrip";
import { isVanRole, isOwner, isPhoneSales, MANAGE_ROLES } from "@/lib/roles";
import ComplaintFromOrder from "@/components/flows/ComplaintFromOrder";
import OrderPriorityToggle from "@/components/sales/OrderPriorityToggle";
import PriorityTag from "@/components/sales/PriorityTag";
import { canSetPriority } from "@/lib/orderPriority";
import CustomerName from "@/components/CustomerName";
import { Icon } from "@/components/meridian/Icon";
import { discountOfOrder } from "@/lib/repo/discounts";
import { DISCOUNT_REASONS, DISCOUNT_STATUS_LABEL } from "@/lib/discounts";
import LiveRefresh from "@/components/LiveRefresh";
import ViewingChip from "@/components/ViewingChip";
import DeliveryRatingCard from "@/components/sales/DeliveryRatingCard";
import { ratingOf } from "@/lib/repo/deliveryRatings";
import OnAccountCreditCard from "@/components/sales/OnAccountCreditCard";
import { onAccountCredit } from "@/lib/repo/onAccount";
import { FULFILLED_ORDER_STATUSES } from "@/lib/orderStateMachine";
import OrderDetailEdit from "@/components/sales/OrderDetailEdit";
import { editRule } from "@/lib/orderEditRules";
import RecordChat from "@/components/RecordChat";
import { canChat } from "@/lib/chat";
import OfficialInvoiceToggle from "@/components/sales/OfficialInvoiceToggle";
import { invoiceNumberText } from "@/lib/invoice";

export const dynamic = "force-dynamic";

/** The nine delivery states, in the words the office uses. */
const ATTEMPT_LABEL: Record<string, string> = {
  PLANNED: "برنامه‌ریزی‌شده",
  ASSIGNED: "تخصیص‌یافته",
  LOADED: "بارگیری‌شده",
  IN_TRANSIT: "در مسیر",
  DELIVERED: "تحویل‌شده",
  PARTIAL: "تحویل ناقص",
  FAILED: "ناموفق",
  RETURNED: "مرجوعی",
  CANCELLED: "لغوشده",
};


/** «سفارش ۱۲# · RouteFlow», the same number the page heading shows. orderPageFor is the page's
 *  own scoped read, so an order this person cannot see falls back to the section title. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  const page = session ? await orderPageFor(session, Number((await params).id)) : null;
  return page
    ? { title: `سفارش ${faNum(Number(page.order.order_no.split("-")[1]))}#` }
    : pageMetadata("/sales/orders");
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");

  const id = Number((await params).id);
  const page = await orderPageFor(session, id);
  if (!page) notFound();
  const { order, attempts } = page;
  const discount = await discountOfOrder(session.organizationId, order.id);
  // F63: credit the customer already paid ahead, offered on an unpaid delivered order to the people who record payments.
  const canRate = (MANAGE_ROLES.includes(session.role) || isPhoneSales(session.role)) && (FULFILLED_ORDER_STATUSES as readonly string[]).includes(order.status);
  const owes = Math.max(0, order.total_toman - order.paid_toman);
  const credit = (MANAGE_ROLES.includes(session.role) || isPhoneSales(session.role)) && owes > 0 && (FULFILLED_ORDER_STATUSES as readonly string[]).includes(order.status) ? await onAccountCredit(session.organizationId, order.customer_id) : 0;

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <LiveRefresh topics={["orders"]} id={order.id} />
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
        <div>
          <h2 className="sechead__title tabular-nums">
            سفارش {faNum(Number(order.order_no.split("-")[1]))}#
          </h2>
          <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--muted)]">
            {/* The name opens the customer (who they are, their other orders, what they owe);
                the pin beside it is the shop on the map. buildMapLink is the same format the
                map's own share links use and parseMapLink already reads on load. */}
            <CustomerName id={order.customer_id} name={order.customer_name} />{" "}
            <Link
              /* buildMapLink already includes the leading "?" -- see lib/deepLink.ts. */
              href={`/map${buildMapLink({ customerId: order.customer_id })}`}
              className="touch inline-flex min-h-11 min-w-11 items-center justify-center align-middle text-[var(--muted)] hover:text-[var(--accent)]"
              aria-label="نمایش روی نقشه"
              title="نمایش روی نقشه"
            >
              <Icon name="map-pin" size="sm" />
            </Link>{" "}
            · {faJalaliDate(order.order_date)} ·{" "}
            {statusLabel(order.status)}
          </p>
          <ViewingChip type="order" id={order.id} />
        </div>
        <Link
          href="/sales/orders"
          className="inline-flex items-center gap-2 text-[length:var(--text-sm)] text-[var(--muted)] no-underline hover:text-[var(--foreground)]"
        >
          <Icon name="arrow-right" size="sm" />
          همه سفارش‌ها
        </Link>
      </div>

      <BentoStrip>
        <BentoIdentity
          eyebrow={order.order_no}
          title={order.ship_name ?? order.customer_name}
          meta={
            <>
              {faJalaliDate(order.order_date)} · {statusLabel(order.status)}
              {order.salesperson_name && ` · ${order.salesperson_name}`}
              {order.ship_phone && <> · <span dir="ltr">{order.ship_phone}</span></>}
              {order.ship_address && ` · ${order.ship_address}`}
              {order.due_date && ` · سررسید ${faJalaliDate(order.due_date)}`}
            </>
          }
        >
          {canChat(session.role) && <RecordChat type="order" id={order.id} name={order.order_no} />}
          {MANAGE_ROLES.includes(session.role) && editRule("detail", order.status).ok && <OrderDetailEdit orderId={order.id} orderNo={order.order_no} isOwner={isOwner(session.role)} />}
          {order.status === "DRAFT" && <ConfirmOrderButton orderId={order.id} />}
          {order.status === "DRAFT" && MANAGE_ROLES.includes(session.role) && <OfficialInvoiceToggle orderId={order.id} on={order.official === 1} />}
          {order.invoice_no != null && order.invoice_year != null && (
            <Link href={`/sales/orders/${order.id}/invoice`} className="btn ghost touch" data-tour="order-invoice">
              <Icon name="receipt" size="md" />
              فاکتور رسمی {invoiceNumberText(order.invoice_year, order.invoice_no)}
            </Link>
          )}
          {isOwner(session.role) && <BooksButton doc="order" id={order.id} />}
          {MANAGE_ROLES.includes(session.role) && canSetPriority(order.status) ? (
            <OrderPriorityToggle orderId={order.id} priority={order.priority} />
          ) : (
            <PriorityTag priority={order.priority} />
          )}
        </BentoIdentity>

        <BentoTile
          label="جمع سفارش"
          value={faToman(order.total_toman)}
          hint={`${faNum(order.lines.length)} قلم · ${faNum(order.kg)} کیلو`}
        />

        {/* Payment is the one reading on this page that can be bad news, so it is the one
            that gets a gauge rather than another figure in a row of figures. Overpayment
            clamps to a full arc but keeps its real number in the caption -- a gauge that
            drew past its own track would look broken rather than informative. */}
        <BentoGauge
          label="پرداخت‌شده"
          fraction={order.total_toman > 0 ? order.paid_toman / order.total_toman : 0}
          caption={`${faToman(order.paid_toman)} از ${faToman(order.total_toman)}`}
          tone={
            order.paid_toman >= order.total_toman && order.total_toman > 0
              ? "var(--success)"
              : "var(--warning)"
          }
        />
      </BentoStrip>

      {canRate && <DeliveryRatingCard orderId={order.id} rating={await ratingOf(session.organizationId, order.id)} />}

      {credit > 0 && <OnAccountCreditCard orderId={order.id} credit={credit} owes={owes} />}

      {discount && (
        <section className="card flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" dir="rtl" aria-label="تخفیف">
          <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
            <strong>تخفیف {faToman(discount.amount_toman)}</strong>
            <span
              className="text-[length:var(--text-sm)]"
              style={{ color: discount.status === "approved" ? "var(--success)" : discount.status === "rejected" ? "var(--danger)" : "var(--warning)" }}
            >
              {DISCOUNT_STATUS_LABEL[discount.status]}
            </span>
          </div>
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">
            {DISCOUNT_REASONS.find((r) => r.id === discount.reason)?.label ?? discount.reason}
            {discount.requested_by_name && ` · درخواست ${discount.requested_by_name}`}
            {discount.decided_by_name && ` · پاسخ ${discount.decided_by_name}`}
          </p>
          <p className="m-0 text-[length:var(--text-sm)]">
            {discount.shares.length === 0
              ? "از کمیسیون کسی کم نمی‌شود؛ شرکت می‌پذیرد."
              : `از کمیسیون: ${discount.shares.map((x) => `${x.display_name} ${faNum(x.share_pct)}٪ (${faToman(x.amount_toman)})`).join("، ")}`}
          </p>
        </section>
      )}

      <OrderStatusPanel
        orderId={order.id}
        status={order.status}
        role={session.role as OrderRole}
      />

      {/* Same roles as POST /api/sales/complaints; offering the button to anyone else would
          only lead to a refusal. A draft has not been sold, so there is nothing to complain about. */}
      {order.status !== "DRAFT" && [...MANAGE_ROLES, "phone_sales"].includes(session.role) && (
        <ComplaintFromOrder
          orderId={order.id}
          customerId={order.customer_id}
          customerName={order.customer_name}
          products={[
            ...new Map(
              order.lines
                .filter((l) => !l.is_reversal)
                .map((l) => [l.product_id, { id: l.product_id, name: l.product_name }] as const),
            ).values(),
          ]}
        />
      )}

      <CardTable className="w-full border-collapse rounded-[var(--radius-lg)] text-[length:var(--text-sm)]">
        <thead>
          <tr className="text-[var(--muted)]">
            <th className="border-b border-[var(--border)] py-[var(--space-2)] text-right font-medium">
              کالا
            </th>
            <th className="border-b border-[var(--border)] py-[var(--space-2)] text-left font-medium">
              تعداد
            </th>
            <th className="border-b border-[var(--border)] py-[var(--space-2)] text-left font-medium">
              واحد
            </th>
            <th className="border-b border-[var(--border)] py-[var(--space-2)] text-left font-medium">
              جمع
            </th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line) => (
            <tr key={line.id}>
              <td className="border-b border-[var(--border)] py-[var(--space-2)] text-[var(--foreground)]">
                {line.product_name}
                <span className="block text-[length:var(--text-xs)] text-[var(--muted)]">
                  {line.packaging_name} · {faNum(line.kg)} کیلو
                </span>
              </td>
              <td className="border-b border-[var(--border)] py-[var(--space-2)] text-left tabular-nums text-[var(--muted)]">
                {faNum(line.packs_ordered)}
              </td>
              <td className="border-b border-[var(--border)] py-[var(--space-2)] text-left tabular-nums text-[var(--muted)]">
                {faToman(line.unit_price_toman)}
                {line.uplift_percent ? <span className="block text-[length:var(--text-xs)] text-[var(--warning)]">سفارش کم، {faNum(Number(line.uplift_percent))}٪ بیشتر</span> : null}
              </td>
              <td className="border-b border-[var(--border)] py-[var(--space-2)] text-left tabular-nums text-[var(--foreground)]">
                {faToman(line.total_toman)}
              </td>
            </tr>
          ))}
        </tbody>
      </CardTable>

      {/* One order's attempts, which is what `deliveries` records. Absent, not empty:
          an order that has never shipped says so in a sentence. */}
      <section className="mt-[var(--space-5)]">
        <h2 className="sechead__title">تلاش‌های تحویل</h2>
        {attempts.length === 0 ? (
          <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-sm)] text-[var(--muted)]">
            برای این سفارش هنوز تلاشی برای تحویل ثبت نشده است.
          </p>
        ) : (
          <ol className="m-0 mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0">
            {attempts.map((a) => (
              <li
                key={a.id}
                className="rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                  <span className="text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                    تلاش {faNum(a.seq)} · {ATTEMPT_LABEL[a.status] ?? "نامشخص"}
                  </span>
                  <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--muted)]">
                    {a.actual_arrival
                      ? faJalaliDateTime(a.actual_arrival)
                      : a.planned_arrival
                        ? `برنامه: ${faJalaliDateTime(a.planned_arrival)}`
                        : "—"}
                  </span>
                </div>
                {(a.fail_reason || a.delay_reason) && (
                  <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
                    {a.fail_reason ? `دلیل ناموفقی: ${a.fail_reason}` : null}
                    {a.fail_reason && a.delay_reason ? " · " : null}
                    {a.delay_reason ? `دلیل تأخیر: ${a.delay_reason}` : null}
                  </p>
                )}
                {a.receiver_name && (
                  <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--muted)]">
                    تحویل به {a.receiver_name}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {order.status === "DRAFT" ? (
        <p className="m-0 text-[length:var(--text-xs)] leading-6 text-[var(--muted)]">
          تا وقتی پیش‌نویس است می‌شود تغییرش داد. بعد از تأیید، اصلاح فقط با ثبت قلم
          برگشتی انجام می‌شود — چون پورسانت از همین عددها حساب می‌شود.
        </p>
      ) : (
        <p className="m-0 text-[length:var(--text-xs)] leading-6 text-[var(--muted)]">
          این سفارش تأیید شده و عددهایش ثابت است. قیمت‌ها همان‌هایی هستند که روز ثبت
          سفارش اعمال شده‌اند، حتی اگر قیمت کالا بعداً تغییر کرده باشد.
        </p>
      )}

      {order.uplift_waive_reason && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--muted)]">
          افزایش قیمت سفارش کم برای این سفارش بخشیده شد. دلیل: {order.uplift_waive_reason}
        </p>
      )}

      {order.below_min_reason && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--warning)] p-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--warning)]">
          جمع این سفارش از حداقل سفارش کمتر بود. دلیل: {order.below_min_reason}
        </p>
      )}

      {order.credit_override_by !== null && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--warning)] p-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--warning)]">
          این سفارش با عبور از سقف اعتبار مشتری ثبت شده است.
        </p>
      )}

      <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">
        ثبت‌شده در {faJalaliDateTime(order.created_at)}
      </p>
    </div>
  );
}
