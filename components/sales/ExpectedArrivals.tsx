import Link from "next/link";
import { faJalaliDate } from "@/lib/jalali";
import { faNum } from "@/lib/format";
import { SLOT_LABEL } from "@/lib/purchaseOrders";
import type { PoRow } from "@/lib/repo/purchaseOrders";

/** F87 on the warehouse page: who is expected to bring goods in the next week (and who is late), with the half of the day. */
export default function ExpectedArrivals({ rows, today, canOpen }: { rows: PoRow[]; today: string; canOpen: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section className="card flex flex-col gap-[var(--space-2)] p-[var(--space-4)]" dir="rtl" data-tour="expected-arrivals" aria-label="رسیدن‌های در راه">
      <h2 className="sechead__title m-0">رسیدن‌های هفتهٔ پیش‌رو</h2>
      <ul className="m-0 flex list-none flex-col gap-[var(--space-1)] p-0 text-[length:var(--text-sm)]">
        {rows.map((o) => (
          <li key={o.id} className="flex flex-wrap justify-between gap-[var(--space-2)]">
            <span>{canOpen ? <Link className="text-[var(--accent-text)]" href="/sales/stock/orders">{o.supplier_name}</Link> : o.supplier_name} · {faNum(o.lines.length)} قلم</span>
            <span style={o.expected_date! < today ? { color: "var(--danger)" } : undefined}>
              {o.expected_date! < today ? "دیر شده · " : o.expected_date === today ? "امروز · " : ""}{faJalaliDate(o.expected_date!)}{o.expected_slot ? ` · ${SLOT_LABEL[o.expected_slot]}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
