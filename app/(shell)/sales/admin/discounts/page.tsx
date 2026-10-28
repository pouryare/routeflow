import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import SectionHead from "@/components/meridian/SectionHead";
import PageHeader from "@/components/meridian/PageHeader";
import DiscountSettingsForm from "@/components/sales/DiscountSettingsForm";
import { discountSettings, recentDiscounts } from "@/lib/repo/discounts";
import { DISCOUNT_REASONS, DISCOUNT_STATUS_LABEL } from "@/lib/discounts";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

export const dynamic = "force-dynamic";

const STATUS_COLOR = { pending: "var(--warn)", approved: "var(--good)", rejected: "var(--crit)" } as const;

/** The company's discount settings, for the owner (the admin layout gates it), and the latest
 *  discounts with their status. */
export default async function DiscountsPage() {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  const [settings, recent] = await Promise.all([discountSettings(session.organizationId), recentDiscounts(session.organizationId)]);

  return (
    <>
      <PageHeader route="/sales/admin/discounts" />
      <DiscountSettingsForm initial={settings} />
      <section className="card p-[var(--space-4)]" dir="rtl">
        <SectionHead title="آخرین تخفیف‌ها" as="h3" className="mb-[var(--space-3)]" />
        {recent.length === 0 ? (
          <p className="m-0 text-[length:var(--text-sm)] text-[var(--text-muted)]">هنوز تخفیفی ثبت نشده است. وقتی فروشنده روی سفارش تخفیف بدهد، اینجا دیده می‌شود.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0 text-[length:var(--text-sm)]">
            {recent.map((d) => (
              <li key={d.id} className="flex flex-col gap-[var(--space-1)] border-b border-[var(--border)] pb-[var(--space-3)]">
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)]">
                  <Link href={`/sales/orders/${d.order_id}`} className="inline-flex min-h-11 items-center font-medium text-[var(--text)]">
                    {d.customer_name} · {d.order_no}
                  </Link>
                  <span style={{ color: STATUS_COLOR[d.status] }}>{DISCOUNT_STATUS_LABEL[d.status]}</span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] text-[var(--text-muted)]">
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
