import type { WeekFigures } from "@/lib/repo/weekCompare";
import { changePercent } from "@/lib/weekCompare";
import { faNum, faToman } from "@/lib/format";

const ROWS: { key: keyof WeekFigures; label: string; money: boolean }[] = [
  { key: "orders", label: "سفارش‌های تأییدشده", money: false },
  { key: "sales_toman", label: "مبلغ فروش", money: true },
  { key: "delivered", label: "سفارش‌های تحویل‌شده", money: false },
  { key: "collected_toman", label: "دریافتی", money: true },
];

function Change({ now, before }: { now: number; before: number }) {
  const pct = changePercent(now, before);
  if (pct === null) return <span className="text-[var(--text-faint)]">{now === 0 ? "بدون تغییر" : "هفتهٔ قبل صفر بود"}</span>;
  const tone = pct > 0 ? "var(--good)" : pct < 0 ? "var(--crit)" : "var(--text-faint)";
  return <span style={{ color: tone }}>{pct === 0 ? "بدون تغییر" : `${pct > 0 ? "+" : "−"}${faNum(Math.abs(pct))}٪`}</span>;
}

/** F67: this week so far against the same days of last week, for the owner and managers. */
export default function WeekCompareCard({ now, before, days }: { now: WeekFigures; before: WeekFigures; days: number }) {
  return (
    <section className="card mb-3 p-[var(--space-4)]">
      <h2 className="sechead__title">این هفته در برابر هفتهٔ قبل</h2>
      <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        {days === 7 ? "از شنبه تا جمعه" : `${faNum(days)} روز اول هفته، در برابر همین روزهای هفتهٔ قبل`}
      </p>
      <ul className="m-0 mt-[var(--space-3)] flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
        {ROWS.map((r) => (
          <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] pb-[var(--space-2)]">
            <span className="text-[var(--text)]">{r.label}</span>
            <span className="tabular-nums text-[var(--text-muted)]">
              {r.money ? faToman(now[r.key]) : faNum(now[r.key])} · قبل {r.money ? faToman(before[r.key]) : faNum(before[r.key])} ·{" "}
              <Change now={now[r.key]} before={before[r.key]} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
