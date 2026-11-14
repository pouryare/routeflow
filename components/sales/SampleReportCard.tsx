import SectionHead from "@/components/meridian/SectionHead";
import { faNum, faToman } from "@/lib/format";
import type { SampleReportRow } from "@/lib/repo/doorSale";
import { SAMPLE_CONVERT_DAYS } from "@/lib/analysis/metrics";

/** F52 first slice, for managers: who gave how many samples in the last month, to how many shops, what it cost,
 *  and how many of those shops bought within a month of the sample. Shown only when there is something to show. */
export default function SampleReportCard({ rows }: { rows: SampleReportRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section data-tour="sample-report" aria-labelledby="sample-report" className="mb-[var(--space-3)]">
      <SectionHead id="sample-report" title="نمونه‌های رایگان، ۳۰ روز گذشته" />
      <p className="m-0 mb-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--muted)]">
        «خرید کرد» یعنی همان مشتری تا {faNum(SAMPLE_CONVERT_DAYS)} روز پس از نمونه سفارش ثبت‌شده داشته است.
      </p>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0">
        {rows.map((r) => (
          <li key={r.user_id} className="rounded-[var(--radius-lg)] border border-[var(--border)] p-[var(--space-3)] text-[length:var(--text-sm)]">
            <div className="font-medium">{r.rep}</div>
            <div className="text-[var(--muted)]">
              {faNum(r.given)} نمونه به {faNum(r.customers)} مشتری · {faNum(r.converted)} خرید کرد · هزینه {faToman(r.cost_toman)}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
