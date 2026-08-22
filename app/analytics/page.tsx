import Link from "next/link";
import { getDb, District, Customer, CoverageStatus } from "@/lib/db";
import { STATUS_LABEL, STATUS_COLOR, daysSinceLastPurchase } from "@/lib/types";

export const dynamic = "force-dynamic";

function countBy<T extends string>(items: T[]): Record<T, number> {
  const out = {} as Record<T, number>;
  for (const v of items) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function fmtDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export default function AnalyticsPage() {
  const db = getDb();
  const districts = db.prepare("SELECT * FROM districts").all() as unknown as District[];
  const customers = db.prepare("SELECT * FROM customers").all() as unknown as Customer[];

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

  const generatedAt = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

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
          <p dir="ltr" className="mt-1 inline-block font-mono text-[length:var(--text-xs)] text-text-faint">
            {generatedAt}
          </p>
        </div>

        <section>
          <h2 className="mb-2 font-mono text-[length:var(--text-xs)] uppercase tracking-wide text-text-muted">
            وضعیت مناطق ({districts.length})
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
                {totalDebt.d0_7.toLocaleString("fa-IR")}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">زیر ۸ روز (تومان)</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-warn">
                {totalDebt.d8_30.toLocaleString("fa-IR")}
              </div>
              <div className="text-[length:var(--text-xs)] text-text-muted">۸ تا ۳۰ روز (تومان)</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-border bg-surface-raised p-3">
              <div className="font-mono text-[length:var(--text-md)] font-bold tabular-nums text-crit">
                {totalDebt.d30.toLocaleString("fa-IR")}
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
                    {c.total.toLocaleString("fa-IR")}
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
