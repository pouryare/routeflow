import type { ReactNode } from "react";
import { faNum } from "@/lib/format";

/** The record header, as a row of unequal tiles rather than a column of field rows.
 *
 *  A definition list answers "what are this record's fields". A strip answers "what is
 *  the state of this record" at a glance, which is the question anyone actually opens the
 *  page with. The tiles are deliberately different sizes: equal thirds are the layout that
 *  says nothing is more important than anything else, which is almost never true.
 */
export default function BentoStrip({ children }: { children: ReactNode }) {
  return (
    <section className="grid gap-[var(--space-3)] rounded-[var(--radius-2xl)] border border-[var(--border)] bg-[var(--surface)] p-[var(--space-3)] sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </section>
  );
}

/** The wide one. Carries the record's identity and spans two columns on a wide screen. */
export function BentoIdentity({
  eyebrow,
  title,
  meta,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-[var(--space-4)] sm:col-span-2">
      <div>
        {eyebrow && (
          <span className="block font-mono text-[length:var(--text-xs)] uppercase tracking-[0.1em] text-[var(--text-faint)]">
            {eyebrow}
          </span>
        )}
        <span className="mt-[var(--space-1)] block text-[length:var(--text-lg)] text-[var(--text)]">
          {title}
        </span>
        {meta && (
          <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {meta}
          </span>
        )}
      </div>
      {children && <div className="mt-[var(--space-3)]">{children}</div>}
    </div>
  );
}

/** A single figure. Mono and tabular, like every number in this app. */
export function BentoTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "warn" | "crit";
}) {
  const color = tone ? `var(--${tone})` : "var(--text)";
  return (
    <div className="rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-[var(--space-4)]">
      <span className="block text-[length:var(--text-xs)] text-[var(--text-muted)]">{label}</span>
      <strong
        className="mt-[var(--space-1)] block font-mono text-[length:var(--text-xl)] font-normal tabular-nums"
        style={{ color }}
      >
        {value}
      </strong>
      {hint && (
        <span className="mt-[var(--space-1)] block text-[length:var(--text-xs)] text-[var(--text-faint)]">
          {hint}
        </span>
      )}
    </div>
  );
}

/** A part-of-whole reading, drawn as an arc.
 *
 *  Deliberately an arc and not a full ring: a 270-degree sweep has a visible start and end,
 *  so "nearly empty" and "nearly full" cannot be confused with each other the way they can
 *  on a closed circle. The percentage is printed in the middle regardless -- the arc is
 *  the glance, the number is the answer.
 */
export function BentoGauge({
  label,
  fraction,
  caption,
  tone = "var(--accent)",
}: {
  label: string;
  /** Clamped to 0..1 by the component; callers routinely produce >1 by overpaying. */
  fraction: number;
  caption?: string;
  tone?: string;
}) {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const R = 34;
  const SWEEP = 270;
  // Arc length of the full 270-degree track; the dash pattern draws `f` of it.
  const track = (SWEEP / 360) * 2 * Math.PI * R;

  return (
    <div className="flex items-center gap-[var(--space-3)] rounded-[var(--radius-xl)] bg-[var(--surface-raised)] p-[var(--space-4)]">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true" className="shrink-0">
        {/* Rotated so the gap sits at the bottom, centred. */}
        <g transform="rotate(135 42 42)">
          <circle
            cx="42" cy="42" r={R}
            fill="none" stroke="var(--border)" strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${track} 999`}
          />
          {/* Not rendered at all when there is nothing to show. A zero-length dash with a
              round cap still paints a dot, so an unpaid order drew a single bead floating
              on an empty track -- which reads as a rendering fault, not as zero. */}
          {f > 0 && (
            <circle
              cx="42" cy="42" r={R}
              fill="none" stroke={tone} strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${track * f} 999`}
              className="chart-arc"
              style={{ ["--arc-len" as string]: `${track * f}` }}
            />
          )}
        </g>
        <text
          x="42" y="42"
          textAnchor="middle" dominantBaseline="central"
          className="fill-[var(--text)] font-mono"
          style={{ fontSize: 16 }}
        >
          {faNum(Math.round(f * 100))}٪
        </text>
      </svg>
      <span className="min-w-0">
        <span className="block text-[length:var(--text-xs)] text-[var(--text-muted)]">{label}</span>
        {caption && (
          <span className="mt-[var(--space-1)] block font-mono text-[length:var(--text-xs)] text-[var(--text-faint)]">
            {caption}
          </span>
        )}
      </span>
    </div>
  );
}
