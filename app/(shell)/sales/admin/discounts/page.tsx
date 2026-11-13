import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import SectionHead from "@/components/meridian/SectionHead";
import PageHeader from "@/components/meridian/PageHeader";
import DiscountSettingsForm from "@/components/sales/DiscountSettingsForm";
import { discountSettings, discountsGiven, recentDiscounts } from "@/lib/repo/discounts";
import { DISCOUNT_REASONS, DISCOUNT_STATUS_LABEL } from "@/lib/discounts";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/admin/discounts");

export const dynamic = "force-dynamic";

const STATUS_COLOR = { pending: "var(--warning)", approved: "var(--success)", rejected: "var(--danger)" } as const;

/** The company's discount settings, for the owner (the admin layout gates it), and the latest
 *  discounts with their status. */
export default async function DiscountsPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const [settings, recent, given] = await Promise.all([discountSettings(session.organizationId), recentDiscounts(session.organizationId), discountsGiven(session.organizationId)]);

  return (
    <>
      <PageHeader route="/sales/admin/discounts" />
      <DiscountSettingsForm initial={settings} />
      <section className="card mb-[var(--space-4)] p-[var(--space-4)]" dir="rtl" data-tour="discounts-given">
        <SectionHead title="تخفیف‌های ۳۰ روز اخیر" as="h3" className="mb-[var(--space-3)]" />
        {given.total === 0 ? (
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">در ۳۰ روز اخیر تخفیفی داده نشده است.</p>
        ) : (
          <>
            <p className="m-0 mb-[var(--space-3)] text-[length:var(--text-sm)]">
              جمع {faToman(given.total)} · {faNum(given.autoCount)} مورد بدون تأیید، {faNum(given.approvedCount)} مورد با تأیید
            </p>
            {([["به تفکیک فروشنده", given.byRep], ["به تفکیک مشتری", given.byCustomer], ["به تفکیک کالا", given.byProduct]] as const).map(([title, rows]) => (
              <div key={title} className="mb-[var(--space-3)]">
                <h4 className="m-0 mb-[var(--space-1)] text-[length:var(--text-xs)] font-medium text-[var(--muted)]">{title}</h4>
                <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
                  {rows.slice(0, 5).map((r) => (
                    <li key={r.name} className="flex justify-between gap-[var(--space-2)]">
                      <span>{r.name}</span>
                      <span className="tabular-nums">{faToman(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>
      <section className="card p-[var(--space-4)]" dir="rtl">
        <SectionHead title="آخرین تخفیف‌ها" as="h3" className="mb-[var(--space-3)]" />
        {recent.length === 0 ? (
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--muted)]">هنوز تخفیفی ثبت نشده است. وقتی فروشنده روی سفارش تخفیف بدهد، اینجا دیده می‌شود.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0 text-[length:var(--text-sm)]">
            {recent.map((d) => (
              <li key={d.id} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-3)]">
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                  <Link href={`/sales/orders/${d.order_id}`} className="inline-flex min-h-11 items-center font-medium text-[var(--foreground)]">
                    {d.customer_name} · {d.order_no}
                  </Link>
                  <span style={{ color: STATUS_COLOR[d.status] }}>{DISCOUNT_STATUS_LABEL[d.status]}</span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] text-[var(--muted)]">
                  <span>
                    {faToman(d.amount_toman)} · {DISCOUNT_REASONS.find((r) => r.id === d.reason)?.label ?? d.reason} · {d.requested_by_name}
                  </span>
                  <span className="tabular-nums">{faJalaliDate(d.requested_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 mt-[var(--space-3)] text-[length:var(--text-xs)] text-[var(--text-faint)]">{faNum(recent.length)} مورد اخیر</p>
      </section>
    </>
  );
}
