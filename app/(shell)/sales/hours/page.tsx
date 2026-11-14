import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { MANAGE_ROLES } from "@/lib/roles";
import PageHeader from "@/components/meridian/PageHeader";
import CardTable from "@/components/CardTable";
import { driverHoursFor } from "@/lib/repo/driverHours";
import { hoursLabel } from "@/lib/driverHours";
import { faNum } from "@/lib/format";
import { faJalaliDate, tehranTodayIso } from "@/lib/jalali";
import { pageMetadata } from "@/lib/pageMeta";

export const metadata = pageMetadata("/sales/hours");
export const dynamic = "force-dynamic";

const WINDOWS = [7, 14, 30] as const;

/** «ساعت کار رانندگان»: per driver and day, the first start, the last finish and the hours between
 *  (from delivery_runs; the driver presses nothing extra). A manager sees their own groups. */
export default async function HoursPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const jar = await cookies();
  const session = await getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!MANAGE_ROLES.includes(session.role)) redirect("/sales");

  const asked = Number((await searchParams).days);
  const days = (WINDOWS as readonly number[]).includes(asked) ? asked : 14;
  const from = new Date(Date.parse(`${tehranTodayIso()}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  const rows = await driverHoursFor(session, from);
  const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran" }) : "—");

  return (
    <>
      <PageHeader route="/sales/hours" />
      <div className="flex flex-col gap-[var(--space-4)]" dir="rtl">
        <nav className="flex flex-wrap items-center gap-2 text-[length:var(--text-sm)]" aria-label="بازهٔ گزارش">
          {WINDOWS.map((d) => (
            <Link
              key={d}
              href={`/sales/hours?days=${d}`}
              aria-current={d === days ? "page" : undefined}
              className={`touch rounded-[var(--radius-sm)] border px-3 py-1 ${d === days ? "border-accent text-accent" : "border-border text-text-muted hover:border-accent hover:text-accent"}`}
            >
              {faNum(d)} روز اخیر
            </Link>
          ))}
        </nav>
        {rows.length === 0 ? (
          <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] leading-7 text-[var(--text-faint)]">
            در این بازه مسیری برای رانندگان ثبت نشده است.
          </p>
        ) : (
          <CardTable className="w-full border-collapse text-[length:var(--text-sm)]">
            <thead>
              <tr className="border-b border-border text-right text-text-muted">
                <th className="py-1 font-normal">روز</th>
                <th className="py-1 font-normal">راننده</th>
                <th className="py-1 font-normal">شروع</th>
                <th className="py-1 font-normal">پایان</th>
                <th className="py-1 font-normal">مجموع</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.run_date}:${r.driver_user_id}`} className="border-b border-border">
                  <td className="py-1">{faJalaliDate(r.run_date)}</td>
                  <td className="py-1 text-text">{r.driver_name}</td>
                  <td className="py-1 tabular-nums">{clock(r.first_start)}</td>
                  <td className="py-1 tabular-nums">{r.open ? "در مسیر" : clock(r.last_finish)}</td>
                  <td className="py-1">{hoursLabel(r.minutes)}{r.runs > 1 ? ` · ${faNum(r.runs)} مسیر` : ""}</td>
                </tr>
              ))}
            </tbody>
          </CardTable>
        )}
      </div>
    </>
  );
}
