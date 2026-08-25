import Link from "next/link";
import { getDb, District, Customer, CoverageStatus } from "@/lib/db";
import { STATUS_LABEL, STATUS_COLOR, daysSinceLastPurchase } from "@/lib/types";
import { readFacilities } from "@/lib/facilities";
import { distanceKm } from "@/lib/geo";
import CostToServePanel, { type CostToServeRow } from "@/components/CostToServePanel";
import { faDateTime, faNum } from "@/lib/format";
import DataFreshness from "@/components/DataFreshness";
import { newestSync } from "@/lib/freshness";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME } from "@/lib/auth";
import { getSessionFromCookies, groupFilter, groupFilterWithShared } from "@/lib/session";

export const dynamic = "force-dynamic";

function countBy<T extends string>(items: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const v of items) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function fmtDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// Open to managers as well as the owner, but every figure on it is scoped: a manager sees
// their own group's coverage and debt, not the province's. The page is an aggregate, so
// the scope has to be applied to the rows it aggregates rather than to the page -- an
// unscoped total is a leak even when no individual customer is named.
export default async function AnalyticsPage() {
  const jar = await cookies();
  const session = getSessionFromCookies(jar.get(COOKIE_NAME)?.value);
  if (!session) redirect("/login");
  if (session.role === "driver") redirect("/driver");
  const f = groupFilter(session);

  const db = getDb();
  const districts = db
    .prepare(`SELECT * FROM districts WHERE 1 = 1${f.sql}`)
    .all(...f.params) as unknown as District[];
  const customers = db
    .prepare(`SELECT * FROM customers WHERE 1 = 1${f.sql}`)
    .all(...f.params) as unknown as Customer[];

  const districtCounts = countBy(districts.map((d) => d.coverage_status));
  const totalDebt = customers.reduce(
    (acc, c) => {
      acc.d0_7 += c.debt_0_7;
      acc.d8_30 += c.debt_8_30;
      acc.d30 += c.debt_30_plus;
      return acc;
    },
    { d0_7: 0, d8_30: 0, d30: 0 }
  );

  const now = new Date();
  const dormant = customers.filter((c) => {
    if (!c.status?.includes("فعال") || c.status.includes("غیرفعال")) return false;
    const days = daysSinceLastPurchase(c, now);
    return days !== null && days > 30;
  }).length;

  const remindersRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN due_date < date('now') THEN 1 ELSE 0 END) as overdue,
         SUM(CASE WHEN due_date = date('now') THEN 1 ELSE 0 END) as today,
         COUNT(*) as total
       FROM reminders WHERE resolved = 0`
    )
    .get() as { overdue: number | null; today: number | null; total: number };

  // Feature 9. Revenue per customer against distance from the site we dispatch from.
  //
  // The join is by business name as free text -- sales rows carry no customer id -- so
  // any renamed or differently-spelled business drops out silently. That gap is counted
  // and surfaced in the panel rather than absorbed, because a total that is quietly
  // missing rows is worse than one that says so.
  const facilities = readFacilities(db, groupFilterWithShared(session));
  const dispatchSite =
    facilities.find((f) => f.is_default_origin === 1) ?? facilities.find((f) => f.kind === "home_base") ?? facilities[0] ?? null;

  const salesByName = db
    .prepare("SELECT customer_name, SUM(amount) as total, COUNT(*) as rows FROM sales GROUP BY customer_name")
    .all() as { customer_name: string; total: number; rows: number }[];

  const knownNames = new Set(customers.map((c) => c.business_name));
  const matchQuality = salesByName.reduce(
    (acc, s) => {
      acc.totalRows += s.rows;
      if (!knownNames.has(s.customer_name)) {
        acc.unmatchedRows += s.rows;
        acc.unmatchedRevenue += s.total;
      }
      return acc;
    },
    { unmatchedRows: 0, totalRows: 0, unmatchedRevenue: 0 }
  );

  const revenueByName = new Map(salesByName.map((s) => [s.customer_name, s.total]));
  const costToServeRows: CostToServeRow[] = customers.map((c) => ({
    business_name: c.business_name,
    customer_code: c.customer_code,
    km:
      dispatchSite && c.lat !== null && c.lng !== null
        ? distanceKm({ lat: c.lat, lng: c.lng }, dispatchSite)
        : null,
    revenue: revenueByName.get(c.business_name) ?? 0,
  }));

  // Feature 12: the last fortnight of days, reconstructed from depot arrivals logged by
  // the geofence. Days with no arrivals are absent rather than shown as zero-hour days:
  // the log is the only evidence there is, and a day nobody recorded is unknown, not empty.
  // Reuses the page's single clock read (line 36) rather than taking its own: every
  // figure on this page should agree on what "now" means, and two reads could land
  // either side of a day boundary and disagree about which days exist.
  const logWindowStart = new Date(now.getTime() - 21 * 86400000).toISOString();

  const dayLogRows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day,
              MIN(created_at) AS first_seen,
              MAX(created_at) AS last_seen,
              COUNT(*) AS stops
       FROM activity_log
       WHERE entity_type = 'facility' AND created_at >= ?
       GROUP BY day
       ORDER BY day DESC
       LIMIT 14`
    )
    .all(logWindowStart) as {
    day: string;
    first_seen: string;
    last_seen: string;
    stops: number;
  }[];

  const doneByDay = new Map(
    (
      db
        .prepare(
          `SELECT planned_date, COUNT(*) AS c FROM visit_plans
           WHERE status = 'done' AND planned_date >= ?
           GROUP BY planned_date`
        )
        .all(logWindowStart.slice(0, 10)) as {
        planned_date: string;
        c: number;
      }[]
    ).map((r) => [r.planned_date, r.c])
  );

  const dayLog = dayLogRows.map((r) => {
    const start = new Date(r.first_seen);
    const end = new Date(r.last_seen);
    const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return {
      day: r.day,
      start: hhmm(start),
      // A single arrival cannot bound a day, so it reports a start and no span rather
      // than a span of zero.
      end: r.stops > 1 ? hhmm(end) : null,
      minutes: r.stops > 1 ? minutes : null,
      stops: r.stops,
      done: doneByDay.get(r.day) ?? 0,
    };
  });

  const topCustomers = db
    .prepare(
      `SELECT customer_name, SUM(amount) as total FROM sales GROUP BY customer_name ORDER BY total DESC LIMIT 10`
    )
    .all() as { customer_name: string; total: number }[];
  const topCustomersMax = Math.max(1, ...topCustomers.map((c) => c.total));

  const weeks: { label: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const end = new Date(now.getTime() - i * 7 * 86400000);
    const start = new Date(end.getTime() - 7 * 86400000);
    const row = db
      .prepare(
        `SELECT COUNT(*) as n FROM activity_log
         WHERE event_type = 'status_change' AND new_value = 'visited'
           AND created_at >= ? AND created_at < ?`
      )
      .get(start.toISOString(), end.toISOString()) as { n: number };
    weeks.push({ label: fmtDate(start), count: row.n });
  }
  const weeksMax = Math.max(1, ...weeks.map((w) => w.count));

  const generatedAt = faDateTime(now.toISOString());

  return (
    <div dir="rtl" className="min-h-screen bg-bg p-4 sm:p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 text-[length:var(--text-sm)] text-text-muted transition-colors duration-[var(--dur-base)] ease-[var(--ease-out)] hover:border-accent hover:text-accent"
          >
            بازگشت به نقشه ←
          </Link>
        </div>

        <div>
          <div className="font-mono text-[length:var(--text-xs)] uppercase tracking-[0.12em] text-accent">
            Analytics
          </div>
          <h1 className="text-[length:var(--text-xl)] font-bold text-text">داشبورد تحلیل پوشش و فروش</h1>
          <p className="mt-1 inline-block font-mono text-[length:var(--text-xs)] text-text-faint">
            {generatedAt}
          </p>
          {/* The timestamp above is when this page was built; this is how old the
              numbers on it are. They are not the same question, and only the second one
              can be wrong. */}
          <DataFreshness syncedAt={newestSync(customers)} now={now} className="mt-1" />
        </div>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            وضعیت مناطق ({faNum(districts.length)})
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(STATUS_LABEL) as CoverageStatus[]).map((s) => (
              <div key={s} className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
                <div className="font-mono text-[length:var(--text-lg)] font-bold tabular-nums" style={{ color: STATUS_COLOR[s] }}>
                  {districtCounts[s] ?? 0}
                </div>
                <div className="text-[length:var(--text-xs)] text-text-muted">{STATUS_LABEL[s]}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
            <div className="font-mono text-[length:var(--text-lg)] font-bold tabular-nums text-warn">{dormant}</div>
            <div className="text-[length:var(--text-xs)] text-text-muted">مشتری راکد (۳۰+ روز)</div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
            <div className="font-mono text-[length:var(--text-lg)] font-bold tabular-nums text-crit">{remindersRow.overdue ?? 0}</div>
            <div className="text-[length:var(--text-xs)] text-text-muted">یادآوری معوق</div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
            <div className="font-mono text-[length:var(--text-lg)] font-bold tabular-nums text-warn">{remindersRow.today ?? 0}</div>
            <div className="text-[length:var(--text-xs)] text-text-muted">یادآوری امروز</div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
            <div className="font-mono text-[length:var(--text-lg)] font-bold tabular-nums text-text">{remindersRow.total}</div>
            <div className="text-[length:var(--text-xs)] text-text-muted">کل یادآوری‌های باز</div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            جمع بدهی مشتریان
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-good">
                {faNum(totalDebt.d0_7)}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">زیر ۸ روز (تومان)</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-warn">
                {faNum(totalDebt.d8_30)}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">۸ تا ۳۰ روز (تومان)</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-crit">
                {faNum(totalDebt.d30)}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">بیش از ۳۰ روز (تومان)</div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            بازدیدهای ثبت‌شده — ۸ هفته اخیر
          </h2>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-4">
            <div className="flex h-32 items-end gap-2">
              {weeks.map((w) => (
                <div key={w.label} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="font-mono text-[length:var(--text-xs)] tabular-nums text-text-muted">{w.count}</span>
                  <div
                    className="w-full rounded-t-[var(--radius-sm)] bg-accent"
                    style={{ height: `${Math.max(4, (w.count / weeksMax) * 88)}px`, opacity: w.count === 0 ? 0.15 : 0.85 }}
                  />
                  <span dir="ltr" className="font-mono text-[length:var(--text-xs)] text-text-faint">
                    {w.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {dayLog.length > 0 && (
          <section>
            <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
              روزهای کاری اخیر
            </h2>
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
              <table className="w-full border-collapse text-[length:var(--text-sm)]">
                <thead>
                  <tr className="border-b border-border bg-surface text-right text-text-muted">
                    <th className="px-3 py-2 font-medium">تاریخ</th>
                    <th className="px-3 py-2 font-medium">شروع</th>
                    <th className="px-3 py-2 font-medium">پایان</th>
                    <th className="px-3 py-2 font-medium">مدت</th>
                    <th className="px-3 py-2 font-medium">توقف در مکان‌های ما</th>
                    <th className="px-3 py-2 font-medium">بازدید انجام‌شده</th>
                  </tr>
                </thead>
                <tbody>
                  {dayLog.map((d) => (
                    <tr key={d.day} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 font-mono tabular-nums text-text">{d.day}</td>
                      <td dir="ltr" className="px-3 py-2 text-right font-mono tabular-nums text-text-muted">{d.start}</td>
                      <td dir="ltr" className="px-3 py-2 text-right font-mono tabular-nums text-text-muted">{d.end ?? "—"}</td>
                      <td className="px-3 py-2 font-mono tabular-nums text-text-muted">
                        {d.minutes === null
                          ? "—"
                          : `${Math.floor(d.minutes / 60)} ساعت و ${d.minutes % 60} دقیقه`}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums text-text-muted">{faNum(d.stops)}</td>
                      <td className="px-3 py-2 font-mono tabular-nums text-text-muted">{faNum(d.done)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[length:var(--text-xs)] leading-5 text-text-faint">
              از روی ثبت خودکار حضور در انبارها و مبدأ ساخته می‌شود — روزهایی که این گزینه خاموش بوده،
              اینجا دیده نمی‌شوند.
            </p>
          </section>
        )}

        <CostToServePanel
          rows={costToServeRows}
          originName={dispatchSite?.name ?? null}
          match={matchQuality}
        />

        {topCustomers.length > 0 && (
          <section>
            <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
              ۱۰ مشتری برتر بر اساس فروش
            </h2>
            <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface-raised p-4">
              {topCustomers.map((c) => (
                <div key={c.customer_name} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-[length:var(--text-sm)] text-text">{c.customer_name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(2, (c.total / topCustomersMax) * 100)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-left font-mono text-[length:var(--text-xs)] tabular-nums text-text-muted">
                    {faNum(c.total)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
