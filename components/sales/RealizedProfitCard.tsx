import CountUp from "@/components/meridian/CountUp";
import { faNum } from "@/lib/format";

/** سود تحقق‌یافته / در انتظار: the margin on delivered orders, split by what customers have
 *  already paid. A customer who pays part of an order moves that part of its margin from the
 *  second figure to the first. Managers and owners only: it is built on product cost. */
export default function RealizedProfitCard({ realized, unrealized }: { realized: number; unrealized: number }) {
  const total = realized + unrealized;
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((realized / total) * 100))) : 0;
  return (
    <section className="card mb-3 p-[var(--space-4)]">
      <h2 className="sechead__title">سود تحقق‌یافته و در انتظار</h2>
      <p className="m-0 mt-[var(--space-1)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        سود سفارش‌های تحویل‌شده، به نسبت آنچه مشتری‌ها پرداخته‌اند
      </p>
      <div className="mt-[var(--space-3)] flex items-start justify-between gap-[var(--space-3)]">
        <div>
          <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">تحقق‌یافته (دریافت‌شده)</div>
          <div className="text-[length:var(--text-lg)] font-semibold tabular-nums text-[var(--text)]">
            <CountUp value={realized} /> <small className="text-[length:var(--text-xs)] font-normal">تومان</small>
          </div>
        </div>
        <div className="text-end">
          <div className="text-[length:var(--text-xs)] text-[var(--text-muted)]">در انتظار پرداخت</div>
          <div className="text-[length:var(--text-lg)] font-semibold tabular-nums text-[var(--text)]">
            <CountUp value={unrealized} /> <small className="text-[length:var(--text-xs)] font-normal">تومان</small>
          </div>
        </div>
      </div>
      <div
        className="realized-bar mt-[var(--space-3)]"
        role="img"
        aria-label={`${faNum(pct)} درصد سود دریافت شده است`}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}
