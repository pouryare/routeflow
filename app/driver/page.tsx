import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies } from "@/lib/session";
import { getDb, plain } from "@/lib/db";
import { readRun, readDriverRuns } from "@/lib/delivery";
import { driverStatementFor } from "@/lib/driverCommissionLedger";
import { faJalaliLong, faJalaliDate, toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { faToman, faNum } from "@/lib/format";
import DriverRun from "@/components/driver/DriverRun";
import SyncStatus from "@/components/SyncStatus";

export const dynamic = "force-dynamic";

/** The driver's whole app: today's round, and nothing else.
 *
 *  Falls back to their most recent run rather than showing an empty screen -- a driver
 *  opening this at 00:30 after a late round is finishing yesterday's work, not starting
 *  a day with no stops.
 */
export default async function DriverPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role !== "driver") redirect("/map");

  const db = getDb();
  const runs = readDriverRuns(db, session.user.id);
  const today = new Date().toISOString().slice(0, 10);
  const chosen = runs.find((r) => r.run_date === today) ?? runs[0];
  const run = chosen ? readRun(db, chosen.id) : null;

  // A read-only glance at their own commission -- a driver never reaches /sales/commission
  // (proxy.ts sends every /sales/* request from a driver back here), so this one card is
  // the only place they can see what their own deliveries have earned. No editor: rates
  // and payments stay owner-only policy, the same as the فروشنده and مدیر گروه ledgers.
  const j = toJalali(new Date().toISOString())!;
  const period = { from: jalaliToIsoDate(j.jy, j.jm, 1), to: jalaliToIsoDate(j.jy, j.jm, j.jd) };
  const commission = driverStatementFor(db, session.user.id, period);

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-[var(--space-4)] py-[var(--space-5)]">
      <SyncStatus />
      <header className="mb-[var(--space-4)] flex items-start justify-between gap-[var(--space-3)]">
        <div>
          <h1 className="m-0 text-[length:var(--text-lg)] font-medium text-[var(--text)]">
            مسیر امروز
          </h1>
          <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {session.user.display_name}
            {run && ` · ${faJalaliLong(run.run_date)}`}
          </p>
        </div>
        <form action="/api/logout" method="post">
          <button
            type="submit"
            className="cursor-pointer rounded-[var(--radius-md)] border border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-muted)] transition-colors duration-[var(--dur-base)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            خروج
          </button>
        </form>
      </header>

      {!run || run.stops.length === 0 ? (
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
    </main>
  );
}
