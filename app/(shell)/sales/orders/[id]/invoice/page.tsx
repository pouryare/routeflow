import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { isVanRole } from "@/lib/roles";
import { orderPageFor } from "@/lib/repo/ordersView";
import { invoiceFor } from "@/lib/repo/invoice";
import { invoiceNumberText } from "@/lib/invoice";
import { faJalaliDate } from "@/lib/jalali";
import { faNum, faToman } from "@/lib/format";
import CardTable from "@/components/CardTable";
import { Icon } from "@/components/meridian/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "فاکتور رسمی" };

/** D7: the official invoice of a confirmed order. Only orders marked official and numbered have one. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (isVanRole(session.role)) redirect("/driver");
  const id = Number((await params).id);
  if (!(await orderPageFor(session, id))) notFound();
  const inv = await invoiceFor(session.organizationId, id);
  if (!inv) notFound();
  const cell = "border-b border-[var(--border)] py-[var(--space-2)]";
  return (
    <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
      <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
        <h2 className="sechead__title tabular-nums">فاکتور رسمی {invoiceNumberText(inv.invoice_year, inv.invoice_no)}</h2>
        <Link href={`/sales/orders/${id}`} className="inline-flex min-h-11 items-center gap-2 text-[length:var(--text-sm)] text-[var(--muted)] no-underline">
          <Icon name="arrow-right" size="sm" />
          سفارش {inv.order_no}
        </Link>
      </div>
      <section className="card grid gap-[var(--space-3)] p-[var(--space-4)] text-[length:var(--text-sm)]" aria-label="طرف‌های فاکتور">
        <p className="m-0"><b>فروشنده:</b> {inv.seller.name} · کد اقتصادی <span dir="ltr">{inv.seller.taxId ?? "—"}</span></p>
        <p className="m-0"><b>خریدار:</b> {inv.buyer.name} · کد اقتصادی <span dir="ltr">{inv.buyer.taxId ?? "—"}</span></p>
        {(inv.buyer.address || inv.buyer.phone) && <p className="m-0 text-[var(--muted)]">{inv.buyer.address}{inv.buyer.phone && <> · <span dir="ltr">{inv.buyer.phone}</span></>}</p>}
        <p className="m-0 text-[var(--muted)]">تاریخ {faJalaliDate(inv.order_date)}</p>
      </section>
      <CardTable className="w-full border-collapse text-[length:var(--text-sm)]">
        <thead>
          <tr className="text-[var(--muted)]">
            <th className={`${cell} text-right font-medium`}>کالا</th>
            <th className={`${cell} text-left font-medium`}>تعداد</th>
            <th className={`${cell} text-left font-medium`}>قیمت</th>
            <th className={`${cell} text-left font-medium`}>مالیات</th>
            <th className={`${cell} text-left font-medium`}>جمع</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i}>
              <td className={cell}>{l.product_name}<span className="block text-[length:var(--text-xs)] text-[var(--muted)]">{l.packaging_name}</span></td>
              <td className={`${cell} text-left tabular-nums`}>{faNum(l.packs)}</td>
              <td className={`${cell} text-left tabular-nums`}>{faToman(l.unit_price_toman)}</td>
              <td className={`${cell} text-left tabular-nums`}>{faNum(l.vat_pct)}٪</td>
              <td className={`${cell} text-left tabular-nums`}>{faToman(l.total_toman)}</td>
            </tr>
          ))}
        </tbody>
      </CardTable>
      <section className="card flex flex-col gap-[var(--space-1)] p-[var(--space-4)] text-[length:var(--text-sm)]" aria-label="جمع فاکتور">
        {inv.discount_toman > 0 && <p className="m-0 flex justify-between"><span>تخفیف</span><span className="tabular-nums">{faToman(inv.discount_toman)}</span></p>}
        <p className="m-0 flex justify-between"><span>جمع بدون مالیات</span><span className="tabular-nums">{faToman(inv.totals.beforeVat)}</span></p>
        <p className="m-0 flex justify-between"><span>مالیات بر ارزش افزوده</span><span className="tabular-nums">{faToman(inv.totals.vat)}</span></p>
        <p className="m-0 flex justify-between font-bold"><span>قابل پرداخت</span><span className="tabular-nums">{faToman(inv.totals.net)}</span></p>
      </section>
      <p className="m-0 text-[length:var(--text-xs)] leading-6 text-[var(--muted)]">قیمت‌ها از قبل مالیات را دارند؛ این فاکتور فقط سهم مالیات را جدا کرده است.</p>
    </div>
  );
}
