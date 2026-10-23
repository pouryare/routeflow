import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import { reasonReport, type ReasonArea } from "@/lib/repo/reasonReport";
import type { ReasonDomain } from "@/lib/repo/reasonCodes";
import PageHeader from "@/components/meridian/PageHeader";
import { faNum } from "@/lib/format";

export const dynamic = "force-dynamic";

const WINDOWS = [30, 90, 365] as const;

const AREA_TITLE: Record<ReasonDomain, string> = {
  delivery_fail: "تحویل ناموفق",
  order_cancel: "لغو سفارش",
  order_return: "مرجوعی",
  delivery_delay: "تأخیر تحویل",
};

function pct(share: number): string {
  return `${faNum(Math.round(share * 100))}٪`;
}

function Area({ area }: { area: ReasonArea }) {
  return (
    <section className="kblock" dir="rtl">
      <div className="bhead">
        <h2>{AREA_TITLE[area.domain]}</h2>
        <div className="n">
          {faNum(area.total)} مورد · {faNum(area.valueToman)} تومان
        </div>
      </div>
      <div className="kblock__body">
        {area.total === 0 ? (
          <p className="text-[length:var(--text-sm)] text-[var(--text-muted)]">در این بازه موردی ثبت نشده.</p>
        ) : (
          <>
            <table className="w-full border-collapse text-[length:var(--text-sm)]">
              <thead>
                <tr className="border-b border-border text-right text-text-muted">
                  <th className="py-1 font-normal">دلیل</th>
                  <th className="py-1 font-normal">تعداد</th>
                  <th className="py-1 font-normal">سهم</th>
                  <th className="py-1 font-normal">ارزش سفارش‌ها (تومان)</th>
                </tr>
              </thead>
              <tbody>
                {area.rows.map((r) => (
                  <tr key={r.label ?? "none"} className="border-b border-border">
                    <td className={`py-1 ${r.label ? "text-text" : "text-warn"}`}>{r.label ?? "بدون دلیل"}</td>
                    <td className="py-1 tabular-nums">{faNum(r.count)}</td>
                    <td className="py-1 tabular-nums">{pct(r.share)}</td>
                    <td className="py-1 tabular-nums">{faNum(r.valueToman)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {area.rows[0]?.label && (
              <p className="mt-2 text-[length:var(--text-sm)] text-text-muted">
                بیشترین دلیل: «{area.rows[0].label}» با {pct(area.rows[0].share)} موارد.
              </p>
            )}
            {area.unexplained > 0 && (
              <p className="mt-1 text-[length:var(--text-xs)] text-text-faint">
                {faNum(area.unexplained)} مورد بدون دلیل ثبت شده؛ این عددها تا همین اندازه ناقص‌اند.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** F144: why orders failed, were cancelled, came back or ran late (lib/repo/reasonReport.ts).
 *  A manager sees their own group's orders; an owner sees the organisation. */
export default async function ReasonsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");

  const asked = Number((await searchParams).days);
  const days = (WINDOWS as readonly number[]).includes(asked) ? asked : 90;
  const areas = await reasonReport(session, days);

  return (
    <>
      <PageHeader route="/sales/reasons" />
      <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
        <nav className="flex flex-wrap items-center gap-2 text-[length:var(--text-sm)]" aria-label="بازهٔ گزارش">
          {WINDOWS.map((d) => (
            <Link
              key={d}
              href={`/sales/reasons?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className={`touch rounded-[var(--radius-sm)] border px-3 py-1 ${
                d === days ? "border-accent text-accent" : "border-border text-text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {faNum(d)} روز اخیر
            </Link>
          ))}
        </nav>
        {areas.map((a) => (
          <Area key={a.domain} area={a} />
        ))}
      </div>
    </>
  );
}
