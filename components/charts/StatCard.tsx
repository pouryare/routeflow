import { Icon } from "@/components/meridian/Icon";
import Sparkline from "@/components/charts/Sparkline";
import type { ReactNode } from "react";
import { seriesColor } from "@/lib/chartPalette";
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
 *
 *  `wash` is the opposite -- purely categorical. It tints the card with the series colour
 *  at the given index so a tile reads as belonging to the same thing as the chart beneath
 *  it. It carries no meaning of its own and must never be used to say "good" or "bad".
 */
export default function StatCard({
  label,
  value,
  hint,
  tone = "plain",
  trend,
  href,
  icon,
  delta,
  deltaGood = "up",
  wash,
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
  /** Change against the previous period, as a fraction: 0.128 renders «۱۲٫۸٪». */
  delta?: number;
  /** Which direction is the good one. Revenue rising is good; debt rising is not, and a
   *  chip that painted every increase green would be actively misleading on half the
   *  tiles this component renders. */
  deltaGood?: "up" | "down";
  /** Index into the categorical palette. Purely decorative grouping -- see above. */
  wash?: number;
}) {
  const washColor = wash === undefined ? null : seriesColor(wash);
  const deltaUp = delta !== undefined && delta > 0;
  const deltaFlat = delta !== undefined && Math.abs(delta) < 0.0005;
  const deltaTone = deltaFlat
    ? "var(--text-muted)"
    : (deltaUp ? "up" : "down") === deltaGood
      ? "var(--good)"
      : "var(--crit)";

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

      <div className="mt-[var(--space-1)] flex flex-wrap items-baseline gap-x-[var(--space-2)] gap-y-[var(--space-1)]">
        <strong
          className="stat-tile__value block font-mono font-normal tracking-[-0.02em] tabular-nums"
          style={{ color: toneColor }}
        >
          {value}
        </strong>

        {delta !== undefined && (
          <span
            className="inline-flex shrink-0 items-center gap-[2px] rounded-[var(--radius-sm)] px-[var(--space-1)] py-[1px] font-mono text-[length:var(--text-xs)] tabular-nums"
            style={{
              color: deltaTone,
              backgroundColor: `color-mix(in srgb, ${deltaTone} 12%, transparent)`,
            }}
          >
            {/* An arrow as well as a colour. The chip has to survive being read by someone
                who cannot separate the two hues, and by anyone printing the page. */}
            <Icon name={deltaFlat ? "dot" : deltaUp ? "arrow-up" : "arrow-down"} size="sm" />
            {faNum(Math.abs(Math.round(delta * 1000) / 10))}٪
          </span>
        )}
      </div>

      {trend && trend.length > 1 && <Sparkline values={trend} className="mt-[var(--space-2)]" />}

      {hint && (
        <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
          {hint}
        </span>
      )}
    </>
  );

  const className =
    "stat-tile relative block overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-4)] no-underline";

  // A diffuse radial in the corner, not a linear fade across the whole card. A 45-degree
  // two-stop gradient is the single most recognisable "generated dashboard" tell, and at
  // this alpha the radial reads as the surface being lit rather than as a coloured card.
  const washStyle = washColor
    ? {
        backgroundImage: `radial-gradient(120% 100% at 100% 0%, color-mix(in srgb, ${washColor} 22%, transparent) 0%, transparent 62%)`,
      }
    : undefined;

  return href ? (
    <a
      href={href}
      style={washStyle}
      className={`${className} transition-[border-color,box-shadow] duration-[var(--dur-base)] hover:border-[var(--border-strong)]`}
    >
      {body}
    </a>
  ) : (
    <div className={className} style={washStyle}>
      {body}
    </div>
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
