"use client";

import { Slider } from "@heroui/react";
import { niceStep, type Bounds } from "@/lib/rangeBar";

/** One draggable bar with two thumbs for a from–to choice over real amounts (the orders list's amount filter).
 *  `onCommit` fires when a thumb is let go, so a list is not re-read on every pixel of the drag. */
export default function RangeBar({
  label,
  bounds,
  value,
  format,
  onChange,
  onCommit,
}: {
  label: string;
  bounds: Bounds;
  value: [number, number];
  format: (n: number) => string;
  onChange: (v: [number, number]) => void;
  onCommit: (v: [number, number]) => void;
}) {
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
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb index={0} />
        <Slider.Thumb index={1} />
      </Slider.Track>
    </Slider>
  );
}
