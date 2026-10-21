import { faNum } from "@/lib/format";
import { STATUS_LABEL, STATUS_TEXT } from "@/lib/types";
import type { CoverageStatus } from "@/lib/db";
import type { CoverageAnalytics } from "@/lib/repo/coverageAnalytics";
import BarChart from "@/components/charts/BarChart";
import CostToServePanel from "@/components/CostToServePanel";
import DataFreshness from "@/components/DataFreshness";
import { newestSync } from "@/lib/freshness";

/** The panels that came across from the retired `/analytics`.
 *
 *  They answer a different question from everything else on the dashboard: not "how much
 *  did we sell" but "how much ground did we cover, and what did covering it cost". That
 *  is why they are one section rather than being scattered among the sales charts —
 *  ground and money are read at different moments by different people.
 *
 *  Everything here is a whole-group aggregate, so the dashboard renders it only for a
 *  role allowed to see one. The gate lives at the call site, not in here, because a
 *  component that hides itself is a component whose absence nobody can explain.
 */
export default function CoveragePanels({
  data,
  now,
}: {
  data: CoverageAnalytics;
  now: Date;
}) {
  const statuses = Object.keys(STATUS_LABEL) as CoverageStatus[];

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <DataFreshness syncedAt={newestSync(data.customers)} now={now} />

      <section>
        <h3 className="sechead__title sechead__title--minor mb-[var(--space-2)]">
          وضعیت مناطق ({faNum(data.districtTotal)})
        </h3>
        <div className="grid grid-cols-2 gap-[var(--space-2)] sm:grid-cols-4">
          {statuses.map((s) => (
            <div
              key={s}
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-[var(--space-3)]"
            >
              <div
                className="mono text-[length:var(--text-lg)] font-bold tabular-nums"
                style={{ color: STATUS_TEXT[s] }}
              >
                {faNum(data.districtCounts[s] ?? 0)}
              </div>
              <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {STATUS_LABEL[s]}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Four counts that each name a thing somebody has to go and do. They are tiles
          rather than a chart because there is no trend in them — a count of overdue
          reminders is a worklist length, and the only useful comparison is to zero. */}
      <section className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
        {[
          { n: data.dormant, label: "مشتری راکد (۳۰+ روز)", tone: "var(--warn)" },
          { n: data.reminders.overdue, label: "یادآوری معوق", tone: "var(--crit)" },
          { n: data.reminders.today, label: "یادآوری امروز", tone: "var(--warn)" },
          { n: data.reminders.total, label: "کل یادآوری‌های باز", tone: "var(--text)" },
        ].map((t) => (
          <div
            key={t.label}
            className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-raised)] p-[var(--space-3)]"
          >
            <div
              className="mono text-[length:var(--text-lg)] font-bold tabular-nums"
              style={{ color: t.tone }}
            >
              {faNum(t.n)}
            </div>
            <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{t.label}</div>
          </div>
        ))}
      </section>

      <BarChart
        title="بازدیدهای ثبت‌شده"
        subtitle="۸ هفته اخیر"
        data={data.weeks.map((w) => ({ label: w.label, value: w.count }))}
        formatValue={(v) => `${faNum(v)} بازدید`}
        barLabel={(v) => faNum(v)}
        empty="هنوز بازدیدی ثبت نشده"
      />

      {data.dayLog.length > 0 && (
        <section>
          <h3 className="sechead__title sechead__title--minor mb-[var(--space-2)]">
            روزهای کاری اخیر
          </h3>
          <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
            <table className="w-full border-collapse text-[length:var(--text-sm)]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-right text-[var(--text-muted)]">
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">تاریخ</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">شروع</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">پایان</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">مدت</th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">
                    توقف در مکان‌های ما
                  </th>
                  <th className="px-[var(--space-3)] py-[var(--space-2)] font-medium">
                    بازدید انجام‌شده
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.dayLog.map((d) => (
                  <tr key={d.day} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="mono px-[var(--space-3)] py-[var(--space-2)] tabular-nums text-[var(--text)]">
                      {d.day}
                    </td>
                    <td dir="ltr" className="mono px-[var(--space-3)] py-[var(--space-2)] text-right tabular-nums text-[var(--text-muted)]">
                      {d.start}
                    </td>
                    <td dir="ltr" className="mono px-[var(--space-3)] py-[var(--space-2)] text-right tabular-nums text-[var(--text-muted)]">
                      {d.end ?? "—"}
                    </td>
                    <td className="mono px-[var(--space-3)] py-[var(--space-2)] tabular-nums text-[var(--text-muted)]">
                      {d.minutes === null
                        ? "—"
                        : `${faNum(Math.floor(d.minutes / 60))} ساعت و ${faNum(d.minutes % 60)} دقیقه`}
                    </td>
                    <td className="mono px-[var(--space-3)] py-[var(--space-2)] tabular-nums text-[var(--text-muted)]">
                      {faNum(d.stops)}
                    </td>
                    <td className="mono px-[var(--space-3)] py-[var(--space-2)] tabular-nums text-[var(--text-muted)]">
                      {faNum(d.done)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-[var(--space-2)] text-[length:var(--text-xs)] leading-5 text-[var(--text-faint)]">
            از روی ثبت خودکار حضور در انبارها و مبدأ ساخته می‌شود — روزهایی که این گزینه خاموش بوده،
            اینجا دیده نمی‌شوند.
          </p>
        </section>
      )}

      <CostToServePanel
        rows={data.costToServe}
        originName={data.dispatchSiteName}
        match={data.match}
      />
    </div>
  );
}
