"use client";

import { motion } from "framer-motion";
import { EASE, DUR, withReducedMotion } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import { faNum } from "@/lib/format";

/** The bar that carries the batch.
 *
 *  Three details do the work, all of them honest rather than decorative:
 *
 *  - The fill glides on --dur-morph instead of snapping to each new percentage. With a
 *    poll once a second, a snapping fill reads as a stutter; a gliding one reads as
 *    continuous work, which is what is actually happening.
 *  - A 1px leading highlight runs ahead of the fill edge. It is the reason the bar looks
 *    alive at 40% during a quiet patch, when the fill itself has not moved in ten
 *    seconds -- the bar is not pretending to progress, it is showing where progress
 *    would continue from.
 *  - The colour is var(--accent), never a literal, so it follows whichever accent the
 *    user has chosen instead of arriving as a bolt-on in someone else's colour. */
export default function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: string;
}) {
  const reduced = usePrefersReducedMotion();
  // Clamped: a counter that briefly exceeds the batch size (or a total of zero on the
  // first poll) would otherwise render a bar over 100% wide, or divide by zero.
  const pct = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;

  return (
    <div className="w-full">
      {label && (
        <p className="mb-1.5 text-[length:var(--text-xs)] text-text-muted">{label}</p>
      )}
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="پیشرفت پردازش لینک‌ها"
        className="relative h-1 w-full overflow-hidden rounded-[var(--radius-sm)] bg-surface"
      >
        <motion.div
          className="absolute inset-y-0 left-0 rounded-[var(--radius-sm)] bg-[color:var(--accent)]"
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={withReducedMotion(
            { duration: DUR.morph, ease: EASE.out },
            reduced
          )}
        />
        {/* The leading edge: a hairline just past the fill, so a stalled bar still
            looks like a bar with somewhere to go. */}
        {!reduced && pct > 0 && pct < 100 && (
          <motion.div
            className="absolute inset-y-0 w-px bg-[color:var(--accent)] opacity-60"
            initial={false}
            animate={{ left: `${pct}%` }}
            transition={withReducedMotion(
              { duration: DUR.morph, ease: EASE.out },
              reduced
            )}
          />
        )}
      </div>
      <p className="mt-1 text-[length:var(--text-xs)] text-text-faint">
        {faNum(done)} از {faNum(total)}
      </p>
    </div>
  );
}
