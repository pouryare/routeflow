import type { ReactNode } from "react";
import { faNum } from "@/lib/format";

export interface LegendEntry {
  label: string;
  color: string;
  /** Shown after the label, already formatted -- «۱۲٬۵۰۰ تومان», «۳۱ سفارش». */
  value?: string;
}

/** The wrapper every chart on the dashboards sits in.
 *
 *  It exists so that three things cannot be forgotten one chart at a time:
 *
 *  - A legend whenever there is more than one series, so identity is never carried by
 *    colour alone. With one series the heading already names it and a legend box is noise.
 *  - A real data table behind a `<details>`. It is the accessible fallback for a screen
 *    reader and for anyone who cannot separate two hues, and it doubles as the answer to
 *    "what is that bar exactly", which is the first thing anyone asks of a chart.
 *  - An empty state that says so. A chart with no data must not render as an empty box
 *    that looks like a loading failure -- for months most of these will legitimately have
 *    nothing in them.
 */
export default function ChartFrame({
  title,
  subtitle,
  legend,
  rows,
  valueHeader = "مقدار",
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendEntry[];
  /** The same numbers the chart draws, for the table. */
  rows?: { label: string; value: number | string }[];
  valueHeader?: string;
  /** Message for when there is nothing to draw. */
  empty?: string;
  children: ReactNode;
}) {
  const isEmpty = rows !== undefined && rows.length === 0;

  return (
    <figure className="m-0 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)]">
      <figcaption className="mb-[var(--space-3)]">
        <h3 className="m-0 text-[length:var(--text-base)] font-medium text-[var(--text)]">{title}</h3>
        {subtitle && (
          <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {subtitle}
          </p>
        )}
      </figcaption>

      {isEmpty ? (
        <p className="my-[var(--space-6)] text-center text-[length:var(--text-sm)] text-[var(--text-faint)]">
          {empty ?? "هنوز داده‌ای ثبت نشده است"}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">{children}</div>

          {legend && legend.length > 1 && (
            <ul className="mt-[var(--space-3)] flex list-none flex-wrap gap-x-[var(--space-4)] gap-y-[var(--space-1)] p-0 text-[length:var(--text-xs)]">
              {legend.map((entry) => (
                <li key={entry.label} className="flex items-center gap-[var(--space-2)]">
                  <span
                    aria-hidden
                    className="inline-block h-[10px] w-[10px] shrink-0 rounded-[3px]"
                    style={{ background: entry.color }}
                  />
                  <span className="text-[var(--text-muted)]">{entry.label}</span>
                  {entry.value && <span className="text-[var(--text-faint)]">{entry.value}</span>}
                </li>
              ))}
            </ul>
          )}

          {rows && rows.length > 0 && (
            <details className="mt-[var(--space-3)]">
              <summary className="cursor-pointer text-[length:var(--text-xs)] text-[var(--text-faint)] hover:text-[var(--text-muted)]">
                جدول داده‌ها
              </summary>
              <table className="mt-[var(--space-2)] w-full border-collapse text-[length:var(--text-xs)]">
                <thead>
                  <tr className="text-[var(--text-faint)]">
                    <th className="border-b border-[var(--border)] py-[var(--space-1)] text-right font-medium">
                      عنوان
                    </th>
                    <th className="border-b border-[var(--border)] py-[var(--space-1)] text-left font-medium">
                      {valueHeader}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <td className="border-b border-[var(--border)] py-[var(--space-1)] text-[var(--text-muted)]">
                        {r.label}
                      </td>
                      <td className="border-b border-[var(--border)] py-[var(--space-1)] text-left tabular-nums text-[var(--text)]">
                        {typeof r.value === "number" ? faNum(r.value) : r.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </figure>
  );
}
