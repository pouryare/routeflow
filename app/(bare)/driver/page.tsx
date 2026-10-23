import { tehranTodayIso, faJalaliLong, faJalaliDate, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { plain } from "@/lib/db";
import { driverHomeData } from "@/lib/repo/driverHome";
import { driverDaySections } from "@/lib/driverDay";
import { faToman, faNum } from "@/lib/format";
import DriverRun from "@/components/driver/DriverRun";
import DriverDaySection from "@/components/driver/DriverDaySection";
import SyncStatus from "@/components/SyncStatus";
import VerifyVisits from "@/components/driver/VerifyVisits";
import NotificationBell from "@/components/NotificationBell";
import { Icon } from "@/components/meridian/Icon";
import SectionHead from "@/components/meridian/SectionHead";
import { isVanRole } from "@/lib/roles";
import NotAVanNotice from "@/components/meridian/NotAVanNotice";
import DriverLinks from "@/components/driver/DriverLinks";
import { driverLinks } from "@/lib/driverLinks";

export const dynamic = "force-dynamic";

/** Phase 6: one line of weather from the run's frozen forecast, or null. */
function weatherLine(run: { weather_json?: string | null }): string | null {
  if (!run.weather_json) return null;
  try {
    const w = JSON.parse(run.weather_json) as { notes_fa?: string[]; cold_chain_capped?: boolean };
    const parts = w.notes_fa ?? [];
    if (w.cold_chain_capped) parts.push("زنجیرهٔ سرد — زمان مسیر محدود است");
    return parts.length ? parts.join(" · ") : null;
  } catch {
    return null;
  }
}

/** The driver's whole app: today's round, and nothing else.
 *
 *  Falls back to their most recent run rather than showing an empty screen -- a driver
 *  opening this at 00:30 after a late round is finishing yesterday's work, not starting
 *  a day with no stops.
 */
/** «روز من» — the driver's whole day, and every hat they hold.
 *
 *  Two sections, both rendered for every van role, unconditionally. The decision is a
 *  pure function (lib/driverDay.ts) rather than inline JSX, because /driver is an async
 *  server component and no test in this repo can render a page — the promise that a
 *  person sees all their work has to live somewhere testable. See
 *  tests/driver-my-day-sections.test.ts.
 *
 *  A dual-hat person used to see deliveries here and prospect visits on /leads, and had
 *  to navigate between two pages for one working day. `isManager` answered a single
 *  question, so it could only ever show one of the two jobs.
 *
 *  The commission card stays inside the deliveries section, gated on `commission.kg > 0`.
 *  It is money, not work, and it belongs to the delivery job only. */
export default async function DriverPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (!isVanRole(session.role)) {
    /* A platform_owner is offered the way forward; everyone else is still bounced. The
       founder's whole job is to inspect how the app looks to his people, and "you may not"
       without a next step is a dead end. Widening this to owners and group managers is
       deliberately NOT done — they were not invited to inspect a driver's day, and
       quietly widening a gate is how a gate stops meaning anything. */
    if (session.role === "platform_owner") return <NotAVanNotice />;
    redirect("/map");
  }

  const sections = driverDaySections(session.role);
  const today = tehranTodayIso();

  // A read-only glance at their own commission -- a driver never reaches /sales/commission
  // (proxy.ts sends every /sales/* request from a driver back here), so this one card is
  // the only place they can see what their own deliveries have earned. No editor: rates
  // and payments stay owner-only policy, the same as the فروشنده and مدیر گروه ledgers.
  const j = toJalali(new Date().toISOString())!;
  const period = { from: jalaliToIsoDate(j.jy, j.jm, 1), to: jalaliToIsoDate(j.jy, j.jm, j.jd) };
  const { run, leadRun, commission } = driverHomeData(session, today, period);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-[var(--space-4)] py-[var(--space-5)]">
      <SyncStatus />
      <VerifyVisits />
      <header className="mb-[var(--space-4)] flex items-start justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="m-0 text-[length:var(--text-lg)] font-medium text-[var(--text)]">
            <a href="/today" className="text-[var(--text)] no-underline hover:text-[var(--accent)]">
              مسیر امروز ›
            </a>
          </h1>
          <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {session.user.display_name}
            {run && ` · ${faJalaliLong(run.run_date)}`}
          </p>
        </div>
        <form action="/api/logout" method="post">
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-[var(--space-2)] cursor-pointer rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-muted)] transition-colors duration-[var(--dur-base)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            <Icon name="logout" size="sm" />
            خروج
          </button>
        </form>
      </header>
      <DriverLinks links={driverLinks(session)} />

      {/* ── Section 1: deliveries ─────────────────────────────────────────── */}
      {sections.includes("deliveries") && (
        <section aria-labelledby="day-deliveries" className="mb-[var(--space-5)]">
          <SectionHead id="day-deliveries" title="تحویل‌ها" />

          {run && weatherLine(run as unknown as { weather_json?: string | null }) && (
            <p className="mb-[var(--space-3)] flex items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--warn)] p-[var(--space-2)] text-center text-[length:var(--text-xs)] text-[var(--text-muted)]">
              <Icon name="weather" size="sm" />
              {weatherLine(run as unknown as { weather_json?: string | null })}
            </p>
          )}

          {!run || run.stops.length === 0 ? (
            /* An EMPTY section, not a missing one. A driver must never read this as
               "there are no deliveries" when the truth is that the section did not
               render. */
            <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border)] p-[var(--space-6)] text-center text-[length:var(--text-sm)] leading-7 text-[var(--text-faint)]">
              امروز مسیری برای شما ثبت نشده است. وقتی مدیر سفارش‌ها را به مسیر شما اضافه کند،
              همین‌جا نمایش داده می‌شود.
            </p>
          ) : (
            <DriverRun
              run={plain([run])[0]}
              driverName={session.user.display_name}
              businessName="فروش و پخش"
            />
          )}

          {commission.kg > 0 && (
            <div className="mt-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)] rounded-[var(--radius-lg)] border border-[var(--border)] p-[var(--space-4)]">
              <div>
                <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                  پورسانت از {faJalaliDate(period.from)}
                </div>
                <div className="mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-faint)]">
                  {faNum(commission.kg)} کیلو تحویل‌شده
                </div>
              </div>
              <div className="tabular-nums text-[length:var(--text-md)] font-medium text-[var(--text)]">
                {faToman(commission.accrued_toman)}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Section 2: prospect visits ────────────────────────────────────── */}
      {sections.includes("visits") && (
        <section aria-labelledby="day-visits" className="mb-[var(--space-5)]">
          <SectionHead id="day-visits" title="بازدیدها و سرنخ‌ها" />
          <DriverDaySection initialRun={leadRun} />
        </section>
      )}

      <NotificationBell />
    </main>
  );
}
