"use client";

import { Slider } from "@heroui/react";

/** One draggable thumb for a single number inside known limits (the discount percent). It sits beside the keypad,
 *  never instead of it: the keypad is for exact figures, this is for the quick coarse pick. */
export default function AmountSlider({
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (n: number) => string;
  onChange: (v: number) => void;
  /** Called once when the thumb is let go (to save), not on every move. */
  onCommit?: (v: number) => void;
}) {
  return (
    <Slider
      aria-label={label}
      minValue={min}
      maxValue={max}
      step={step}
      value={Math.min(max, Math.max(min, value))}
      onChange={(v) => onChange(v as number)}
      onChangeEnd={(v) => onCommit?.(v as number)}
      className="w-full"
    >
      <div className="mb-[var(--space-1)] flex items-center justify-between text-[length:var(--text-xs)] text-[var(--text-muted)]">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--text)]">{format(value)}</span>
      </div>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  );
}
