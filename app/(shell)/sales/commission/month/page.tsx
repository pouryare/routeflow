import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { isOwner } from "@/lib/roles";
import { payrollSheet } from "@/lib/repo/payrollSheet";
import { JALALI_MONTHS, shiftMonth, todayJalali } from "@/lib/jalali";
import { faNum, faToman } from "@/lib/format";
import PageHeader from "@/components/meridian/PageHeader";
import { Icon } from "@/components/meridian/Icon";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/commission/month");
export const dynamic = "force-dynamic";

/** F90: «برگهٔ پرداخت ماه» for the accountant. The owner reads each person's commission (from the three commission statements,
 *  never recalculated) and approved staff costs for one Jalali month, and downloads it as a CSV. */
export default async function PayrollMonthPage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const session = await getSessionFromCookies((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!isOwner(session.role)) redirect("/sales/commission");
  const q = await searchParams;
  const now = todayJalali();
  const jy = Number(q.y) >= 1380 && Number(q.y) <= 1500 ? Number(q.y) : now.jy;
  const jm = Number(q.m) >= 1 && Number(q.m) <= 12 ? Number(q.m) : now.jm;
  const prev = shiftMonth(jy, jm, -1), next = shiftMonth(jy, jm, 1);
  const rows = await payrollSheet(session, jy, jm);
  const link = (x: { jy: number; jm: number }) => `/sales/commission/month?y=${x.jy}&m=${x.jm}`;
  const NAV = "inline-flex min-h-[44px] items-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-4)] text-[length:var(--text-sm)] no-underline";
  return (
    <>
      <PageHeader route="/sales/commission/month" />
      <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          <span className="flex items-center gap-[var(--space-2)]">
            <Link className={NAV} href={link(prev)} aria-label="ماه قبل"><Icon name="arrow-right" size="sm" /></Link>
            <b>{JALALI_MONTHS[jm - 1]} {faNum(jy)}</b>
            <Link className={NAV} href={link(next)} aria-label="ماه بعد"><Icon name="arrow-left" size="sm" /></Link>
          </span>
          <a className={NAV} href={`/api/sales/commission/month?y=${jy}&m=${jm}`} download><Icon name="download" size="md" />دریافت CSV</a>
        </div>
        {rows.length === 0 ? (
          <p className="m-0 rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--muted)]">در این ماه پورسانت یا هزینه‌ای برای کسی ثبت نشده است.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[var(--space-3)] p-0">
            {rows.map((r) => (
              <li key={r.user_id} className="card flex flex-col gap-[var(--space-1)] p-[var(--space-4)] text-[length:var(--text-sm)]">
                <b>{r.name} <span className="font-normal text-[var(--muted)]">· {r.kinds.join("، ")}</span></b>
                <span>پورسانت ماه {faToman(r.accrued_toman)}{r.deduction_toman > 0 ? ` · کسر تخفیف ${faToman(r.deduction_toman)}` : ""} · خالص <b>{faToman(r.net_toman)}</b></span>
                <span className="text-[var(--muted)]">پرداخت‌شده {faToman(r.paid_toman)} · مانده کل {faToman(r.owed_toman)}</span>
                {r.claims_approved_toman > 0 ? <span>هزینهٔ تأییدشده {faToman(r.claims_approved_toman)}{r.claims_unpaid_toman > 0 ? ` (${faToman(r.claims_unpaid_toman)} هنوز پرداخت نشده)` : ""}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 text-[length:var(--text-xs)] text-[var(--muted)]">حقوق ثابت و حضور و غیاب در برنامه نیست و در این برگه نمی‌آید. عددها همان عددهای صفحهٔ پورسانت‌اند.</p>
      </div>
    </>
  );
}
