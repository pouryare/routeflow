import Link from "next/link";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readOrder } from "@/lib/orders";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, faJalaliDateTime } from "@/lib/jalali";
import { buildMapLink } from "@/lib/deepLink";
import ConfirmOrderButton from "@/components/sales/ConfirmOrderButton";
import BentoStrip, {
  BentoIdentity,
  BentoTile,
  BentoGauge,
} from "@/components/BentoStrip";
import Reveal from "@/components/kargah/Reveal";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "پیش‌نویس",
  confirmed: "تأییدشده",
  delivered: "تحویل‌شده",
  cancelled: "لغوشده",
};

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");

  const id = Number((await params).id);
  const db = getDb();

  // The same scope fragment the list and the API use. An order in another group is a
  // 404 here too, not a page that renders with an error -- otherwise the existence of
  // the row leaks through the difference.
  const scope = orderFilter(session);
  const visible = db
    .prepare(`SELECT o.id FROM orders o WHERE o.id = ?${scope.sql}`)
    .get(id, ...scope.params);
  if (!visible) notFound();

  const order = readOrder(db, id);
  if (!order) notFound();

  return (
    <Reveal replayKey="order" className="flex flex-col gap-[var(--space-4)]">
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
        <div>
          <h2 className="m-0 text-[length:var(--text-lg)] font-medium tabular-nums text-[var(--text)]">
            سفارش {faNum(Number(order.order_no.split("-")[1]))}#
          </h2>
          <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
            {/* Back to the shop on the map. buildMapLink is the same format the map's
                own share links use and parseMapLink already reads on load, so this
                needs no new plumbing on the receiving side. */}
            <Link
              /* buildMapLink already includes the leading "?" -- see lib/deepLink.ts. */
              href={`/map${buildMapLink({ customerId: order.customer_id })}`}
              className="text-[var(--text)] no-underline underline-offset-2 hover:text-[var(--accent)] hover:underline"
              title="نمایش روی نقشه"
            >
              {order.customer_name}
            </Link>{" "}
            · {faJalaliDate(order.order_date)} ·{" "}
            {STATUS_LABEL[order.status] ?? order.status}
          </p>
        </div>
        <Link
          href="/sales/orders"
          className="text-[length:var(--text-sm)] text-[var(--text-muted)] no-underline hover:text-[var(--text)]"
        >
          ← همه سفارش‌ها
        </Link>
      </div>

      <BentoStrip>
        <BentoIdentity
          eyebrow={order.order_no}
          title={order.customer_name}
          meta={
            <>
              {faJalaliDate(order.order_date)} · {STATUS_LABEL[order.status] ?? order.status}
              {order.salesperson_name && ` · ${order.salesperson_name}`}
            </>
          }
        >
          {order.status === "draft" && <ConfirmOrderButton orderId={order.id} />}
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
              ? "var(--good)"
              : "var(--warn)"
          }
        />
      </BentoStrip>

      <table className="w-full border-collapse rounded-[var(--radius-lg)] text-[length:var(--text-sm)]">
        <thead>
          <tr className="text-[var(--text-muted)]">
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
              <td className="border-b border-[var(--border)] py-[var(--space-2)] text-[var(--text)]">
                {line.product_name}
                <span className="block text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  {line.packaging_name} · {faNum(line.kg)} کیلو
                </span>
              </td>
              <td className="border-b border-[var(--border)] py-[var(--space-2)] text-left tabular-nums text-[var(--text-muted)]">
                {faNum(line.packs_ordered)}
              </td>
              <td className="border-b border-[var(--border)] py-[var(--space-2)] text-left tabular-nums text-[var(--text-muted)]">
                {faToman(line.unit_price_toman)}
              </td>
              <td className="border-b border-[var(--border)] py-[var(--space-2)] text-left tabular-nums text-[var(--text)]">
                {faToman(line.total_toman)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {order.status === "draft" ? (
        <p className="m-0 text-[length:var(--text-xs)] leading-6 text-[var(--text-muted)]">
          تا وقتی پیش‌نویس است می‌شود تغییرش داد. بعد از تأیید، اصلاح فقط با ثبت قلم
          برگشتی انجام می‌شود — چون پورسانت از همین عددها حساب می‌شود.
        </p>
      ) : (
        <p className="m-0 text-[length:var(--text-xs)] leading-6 text-[var(--text-muted)]">
          این سفارش تأیید شده و عددهایش ثابت است. قیمت‌ها همان‌هایی هستند که روز ثبت
          سفارش اعمال شده‌اند، حتی اگر قیمت کالا بعداً تغییر کرده باشد.
        </p>
      )}

      {order.credit_override_by !== null && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--warn)] p-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--warn)]">
          این سفارش با عبور از سقف اعتبار مشتری ثبت شده است.
        </p>
      )}

      <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-muted)]">
        ثبت‌شده در {faJalaliDateTime(order.created_at)}
      </p>
    </Reveal>
  );
}
