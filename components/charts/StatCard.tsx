import type { ReactNode } from "react";
import { linePath } from "@/lib/chartScale";
import { SINGLE_SERIES_COLOR } from "@/lib/chartPalette";
import { faNum } from "@/lib/format";

/** One number, large. The right answer more often than a chart is.
 *
 *  «فروش امروز: ۴٬۲۰۰٬۰۰۰ تومان» needs no axis, no legend and no plot -- drawing a
 *  single-bar chart around it would be decoration standing between the reader and the
 *  figure. The optional sparkline is the exception that earns its space: it turns the
 *  number into a number *with a direction* at almost no cost.
 *
 *  `tone` is for status, not for category: a debt figure going critical, a stock count
 *  at zero. Left alone, the figure is plain text -- most numbers are not alarming and
 *  colouring them all trains the eye to ignore the colour.
 */
export default function StatCard({
  label,
  value,
  hint,
  tone = "plain",
  trend,
  href,
  icon,
}: {
  label: string;
  /** Already formatted -- «۱۲٬۵۰۰ تومان». Formatting is the caller's decision. */
  value: string;
  hint?: string;
  tone?: "plain" | "good" | "warn" | "crit";
  /** Oldest last, like LineChart. Drawn as a sparkline under the value. */
  trend?: number[];
  href?: string;
  icon?: ReactNode;
}) {
  const toneColor =
    tone === "good"
      ? "var(--good)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "crit"
          ? "var(--crit)"
          : "var(--text)";

  const body = (
    <>
      <div className="flex items-center gap-[var(--space-2)]">
        {icon}
        <span className="text-[length:var(--text-xs)] text-[var(--text-muted)]">{label}</span>
      </div>

      <strong
        className="mt-[var(--space-1)] block text-[length:var(--text-xl)] font-medium tabular-nums"
        style={{ color: toneColor }}
      >
        {value}
      </strong>

      {trend && trend.length > 1 && (
        <svg
          viewBox="0 0 120 28"
          width="100%"
          height={28}
          className="mt-[var(--space-2)] block"
          aria-hidden
        >
          <path
            d={linePath(trend, 120, 24)}
            fill="none"
            stroke={SINGLE_SERIES_COLOR}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.8}
          />
        </svg>
      )}

      {hint && (
        <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-faint)]">
          {hint}
        </span>
      )}
    </>
  );

  const className =
    "block rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] no-underline";

  return href ? (
    <a
      href={href}
      className={`${className} transition-[border-color] duration-[var(--dur-base)] hover:border-[var(--border-strong)]`}
    >
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** A row of stat cards. Four across on a wide screen, two on a phone -- past four the
 *  row stops being scannable and becomes a wall, which is the point of keeping the rest
 *  of a dashboard behind CollapsibleSection. */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-[var(--space-3)] md:grid-cols-4">{children}</div>
  );
}

/** Formats a count with its unit for a StatCard value. */
export function statCount(n: number, unit: string): string {
  return `${faNum(n)} ${unit}`;
}
