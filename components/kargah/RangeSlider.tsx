"use client";

import { cn } from "@/lib/cn";
import { fillPercent } from "@/lib/design/rangeFill";

/** A genuinely interactive (draggable) pill-readout range slider, generalizing the fill
 *  math ProcessingModal's read-only meter already uses -- same hard-stop gradient syntax
 *  (`var(--accent) 0 X%, var(--sunk) X% 100%`), not a soft transparent fade. Takes
 *  direction: rtl on the input itself so the native fill-from behaviour matches this
 *  app's writing direction. */
export default function RangeSlider({
  label,
  min,
  max,
  value,
  onChange,
  formatValue = (v: number) => String(v),
  className,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const pct = fillPercent(value, min, max);
  return (
    <div className={cn("block", className)}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[length:var(--text-sm)] text-[var(--text-muted)]">{label}</span>
        <span className="text-[length:var(--text-lg)] font-medium text-[var(--text)]">
          {formatValue(value)}
        </span>
      </div>
      <input
        role="slider"
        type="range"
        min={min}
        max={max}
        value={value}
        dir="rtl"
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full appearance-none rounded-[var(--radius-pill)] outline-none"
        style={{
          backgroundImage: `linear-gradient(to left, var(--accent) 0 ${pct}%, var(--surface-sunk) ${pct}% 100%)`,
        }}
      />
    </div>
  );
}
