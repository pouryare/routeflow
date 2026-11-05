"use client";

import { Slider } from "@heroui/react";
import { niceStep, type Bounds } from "@/lib/rangeBar";

/** One draggable bar with two thumbs for a from–to choice over real amounts (the orders list's amount filter),
 *  with optional count bars above it.
 *  `onCommit` fires when a thumb is let go, so a list is not re-read on every pixel of the drag. */
export default function RangeBar({
  label,
  bounds,
  value,
  format,
  onChange,
  onCommit,
  bars,
}: {
  label: string;
  bounds: Bounds;
  value: [number, number];
  format: (n: number) => string;
  onChange: (v: [number, number]) => void;
  onCommit: (v: [number, number]) => void;
  /** How many items sit in each equal slice of the bounds (lib/rangeBar histogram): drawn as small bars
   *  above the track, lit inside the chosen range, so a person sees where the amounts bunch up. */
  bars?: number[];
}) {
  const tallest = bars ? Math.max(1, ...bars) : 1;
  const span = bounds.max - bounds.min;
  return (
    <Slider
      aria-label={label}
      minValue={bounds.min}
      maxValue={bounds.max}
      step={niceStep(bounds.max - bounds.min)}
      value={value}
      onChange={(v) => onChange(v as [number, number])}
      onChangeEnd={(v) => onCommit(v as [number, number])}
      className="w-full"
    >
      <div className="mb-[var(--space-1)] flex items-center justify-between gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--text-muted)]">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--text)]">
          {format(value[0])} تا {format(value[1])}
        </span>
      </div>
      {bars && (
        <div aria-hidden className="rangebar__bars">
          {bars.map((n, i) => {
            const from = bounds.min + (span * i) / bars.length;
            const to = bounds.min + (span * (i + 1)) / bars.length;
            const lit = to >= value[0] && from <= value[1];
            return <span key={i} data-lit={lit || undefined} style={{ height: `${n ? 12 + (88 * n) / tallest : 0}%` }} />;
          })}
        </div>
      )}
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb index={0} />
        <Slider.Thumb index={1} />
      </Slider.Track>
    </Slider>
  );
}
