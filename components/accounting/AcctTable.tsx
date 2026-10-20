import type { ReactNode } from "react";

/** The table every accounting report is made of.
 *
 *  Hand-rolled per page would be eleven near-identical tables, and the one that drifted
 *  would be the balance sheet's total row. `tnum` is on the numeric cells so figures line
 *  up in a column — Persian digits are proportional, and a money column that does not line
 *  up cannot be scanned. */
export default function AcctTable({
  head,
  children,
  foot,
  compact = false,
}: {
  head: ReactNode[];
  children: ReactNode;
  foot?: ReactNode;
  /** Few narrow columns (the balance sheet's three side-by-side tables): no minimum width,
   *  so they do not force sideways scrolling on a desktop grid. */
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
      <table className={`w-full ${compact ? "" : "min-w-[40rem]"} border-collapse text-[length:var(--text-sm)] [&_.tnum]:whitespace-nowrap`}>
        <thead>
          <tr className="border-b border-border bg-surface text-right text-text-muted">
            {head.map((h, i) => (
              <th
                key={i}
                className={`px-3 py-2 font-medium ${i > 0 ? "text-left tnum" : ""}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
        {foot ? (
          <tfoot className="border-t-2 border-border font-medium">{foot}</tfoot>
        ) : null}
      </table>
    </div>
  );
}

export const CELL = "px-3 py-2";
export const NUM = "px-3 py-2 text-left tnum";

/** The honesty banner.
 *
 *  Requirement 2 of the accounting section: a screen must never look more certain than the
 *  data underneath it. Where a period's cost of goods is unknown — backfilled history has
 *  none — the report says so ON THE SCREEN rather than in a tooltip nobody opens. */
export function CostIncompleteNote() {
  return (
    <div
      role="status"
      className="mb-3 rounded-[var(--radius-md)] border border-warn/40 bg-warn/10 px-3 py-2 text-[length:var(--text-sm)]"
    >
      <strong className="font-medium">ناقص از نظر بهای تمام‌شده.</strong> بخشی از فروش‌های این
      دوره پیش از راه‌اندازی دفتر بوده‌اند و بهای تمام‌شده‌ای برایشان ثبت نشده است. سود نمایش‌داده‌شده
      بیش از واقع برآورد می‌شود.
    </div>
  );
}

/** The banner for a ledger that does not balance.
 *
 *  It should be impossible. If it ever renders, the number is a broken ledger and the
 *  operator needs to see it in this exact place rather than discover it in a tax return. */
export function UnbalancedBanner({ difference }: { difference: number }) {
  if (difference === 0) return null;
  return (
    <div
      role="alert"
      className="mb-3 rounded-[var(--radius-md)] border border-danger/50 bg-danger/10 px-3 py-2 text-[length:var(--text-sm)]"
    >
      <strong className="font-medium">ترازنامه تراز نیست.</strong> اختلاف{" "}
      <span className="tnum">{difference.toLocaleString("fa-IR")}</span> تومان است. این یعنی دفتر
      خراب است؛ ارقام زیر را مبنای تصمیم‌گیری نگذارید.
    </div>
  );
}