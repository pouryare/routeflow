"use client";

import { ProgressBar as HeroProgressBar } from "@heroui/react";
import { faNum } from "@/lib/format";

/** The bar that carries the batch: HeroUI's ProgressBar, whose fill glides to each new value
 *  (the poll is once a second, so a snapping fill would read as a stutter). `total` of zero on
 *  the first poll and a counter briefly past the batch size are both clamped. */
export default function ProgressBar({
  done,
  total,
  label,
}: {
  done: number;
  total: number;
  label?: string;
}) {
  const max = Math.max(1, total);
  return (
    <HeroProgressBar
      aria-label="پیشرفت پردازش لینک‌ها"
      value={Math.min(Math.max(0, done), max)}
      minValue={0}
      maxValue={max}
      size="sm"
      className="w-full"
    >
      {label ? <p className="mb-1.5 text-[length:var(--text-xs)] text-text-muted">{label}</p> : null}
      <HeroProgressBar.Track>
        <HeroProgressBar.Fill />
      </HeroProgressBar.Track>
      <p className="mt-1 text-[length:var(--text-xs)] text-text-faint">
        {faNum(done)} از {faNum(total)}
      </p>
    </HeroProgressBar>
  );
}
