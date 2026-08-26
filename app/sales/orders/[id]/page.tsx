import Link from "next/link";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, orderFilter } from "@/lib/session";
import { getDb } from "@/lib/db";
import { readOrder } from "@/lib/orders";
import { faToman, faNum } from "@/lib/format";
import { faJalaliDate, faJalaliDateTime } from "@/lib/jalali";
import ConfirmOrderButton from "@/components/sales/ConfirmOrderButton";

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
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
        <div>
          <h2 className="m-0 text-[length:var(--text-lg)] font-medium tabular-nums text-[var(--text)]">
            سفارش {faNum(Number(order.order_no.split("-")[1]))}#
          </h2>
          <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-sm)] text-[var(--text-muted)]">
            {order.customer_name} · {faJalaliDate(order.order_date)} ·{" "}
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

      <table className="w-full border-collapse rounded-[var(--radius-lg)] text-[length:var(--text-sm)]">
        <thead>
          <tr className="text-[var(--text-faint)]">
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
                <span className="block text-[length:var(--text-xs)] text-[var(--text-faint)]">
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

      <div className="flex flex-wrap items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
        <div>
          <strong className="block text-[length:var(--text-lg)] font-medium tabular-nums text-[var(--text)]">
            {faToman(order.total_toman)}
          </strong>
          <span className="text-[length:var(--text-xs)] tabular-nums text-[var(--text-muted)]">
            {faNum(order.lines.length)} قلم · {faNum(order.kg)} کیلو
            {order.salesperson_name && ` · ${order.salesperson_name}`}
          </span>
        </div>
        {order.status === "draft" && <ConfirmOrderButton orderId={order.id} />}
      </div>

      {order.status === "draft" ? (
        <p className="m-0 text-[length:var(--text-xs)] leading-6 text-[var(--text-faint)]">
          تا وقتی پیش‌نویس است می‌شود تغییرش داد. بعد از تأیید، اصلاح فقط با ثبت قلم
          برگشتی انجام می‌شود — چون پورسانت از همین عددها حساب می‌شود.
        </p>
      ) : (
        <p className="m-0 text-[length:var(--text-xs)] leading-6 text-[var(--text-faint)]">
          این سفارش تأیید شده و عددهایش ثابت است. قیمت‌ها همان‌هایی هستند که روز ثبت
          سفارش اعمال شده‌اند، حتی اگر قیمت کالا بعداً تغییر کرده باشد.
        </p>
      )}

      {order.credit_override_by !== null && (
        <p className="m-0 rounded-[var(--radius-md)] border border-[var(--warn)] p-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--warn)]">
          این سفارش با عبور از سقف اعتبار مشتری ثبت شده است.
        </p>
      )}

      <p className="m-0 text-[length:var(--text-xs)] text-[var(--text-faint)]">
        ثبت‌شده در {faJalaliDateTime(order.created_at)}
      </p>
    </div>
  );
}
