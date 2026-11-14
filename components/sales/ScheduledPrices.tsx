import { faToman, faNum } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import type { ScheduledPrice } from "@/lib/repo/priceBases";

/** F56: price changes already booked for a future day, with the size of what they touch (packs sold in the last 30 days). */
export default function ScheduledPrices({ rows }: { rows: ScheduledPrice[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="card flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" dir="rtl" data-tour="scheduled-prices" aria-label="قیمت‌های برنامه‌ریزی‌شده">
      <h2 className="sechead__title m-0">قیمت‌های برنامه‌ریزی‌شده</h2>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-2)] p-0 text-[length:var(--text-sm)]">
        {rows.map((r, i) => {
          const pct = r.current_toman ? Math.round(((r.price_toman - r.current_toman) / r.current_toman) * 100) : null;
          return (
            <li key={i}>
              <b>{r.product_name}{r.packaging_name ? ` · ${r.packaging_name}` : ""}</b> از {faJalaliDate(r.valid_from)}: {r.current_toman === null ? "" : `${faToman(r.current_toman)} ← `}{faToman(r.price_toman)}
              {pct !== null ? <span style={{ color: pct > 0 ? "var(--warning)" : "var(--success)" }}> ({pct > 0 ? "+" : ""}{faNum(pct)}٪)</span> : null}
              <span className="block text-[length:var(--text-xs)] text-[var(--muted)]">۳۰ روز گذشته {faNum(r.packs_30d)} بسته فروخته شده</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
