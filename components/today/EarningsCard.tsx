import HideMoneyButton from "@/components/HideMoneyButton";
import { Icon } from "@/components/meridian/Icon";
import Link from "next/link";
import type { EarningsSoFar } from "@/lib/repo/earningsSoFar";
import { faNum } from "@/lib/format";
import CountUp from "@/components/meridian/CountUp";
import { faJalaliDate } from "@/lib/jalali";

/** F19: this month's commission so far, on the seller's briefing. The figures come from the
 *  commission engine; the link opens the full statement with every order behind them. */
export default function EarningsCard({ e }: { e: EarningsSoFar }) {
  return (
    <section className="card mb-3 p-[var(--space-4)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="sechead__title">پورسانت این ماه تا امروز</h2>
        <HideMoneyButton />
      </div>
      <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        از {faJalaliDate(e.from)} · {faNum(e.orders)} سفارش تحویل‌شده · {faNum(e.kg)} کیلو
      </p>
      <p className="m-0 mt-[var(--space-2)] text-[length:var(--text-lg)] font-semibold tabular-nums text-[var(--text)]">
        <CountUp value={e.accrued_toman} /> تومان
      </p>
      <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        پرداخت‌شده در این ماه <CountUp value={e.paid_toman} /> تومان · مانده تا امروز <CountUp value={e.owed_toman} /> تومان
      </p>
      <Link href="/sales/commission" className="btn mt-[var(--space-2)] inline-flex min-h-[44px] items-center gap-[var(--space-2)]">
        <Icon name="receipt" size="sm" />
        دیدن سفارش‌های این پورسانت
      </Link>
    </section>
  );
}
