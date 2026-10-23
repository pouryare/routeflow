import Link from "next/link";
import type { EarningsSoFar } from "@/lib/repo/earningsSoFar";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

/** F19: this month's commission so far, on the seller's briefing. The figures come from the
 *  commission engine; the link opens the full statement with every order behind them. */
export default function EarningsCard({ e }: { e: EarningsSoFar }) {
  return (
    <section className="card mb-3 p-[var(--space-4)]">
      <h2 className="sechead__title">پورسانت این ماه تا امروز</h2>
      <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        از {faJalaliDate(e.from)} · {faNum(e.orders)} سفارش تحویل‌شده · {faNum(e.kg)} کیلو
      </p>
      <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-lg)] font-semibold tabular-nums text-[var(--text)]">
        {faToman(e.accrued_toman)}
      </p>
      <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        پرداخت‌شده در این ماه {faToman(e.paid_toman)} · مانده تا امروز {faToman(e.owed_toman)}
      </p>
      <Link href="/sales/commission" className="btn mt-[var(--space-2)] inline-flex min-h-[44px] items-center">
        دیدن سفارش‌های این پورسانت
      </Link>
    </section>
  );
}
