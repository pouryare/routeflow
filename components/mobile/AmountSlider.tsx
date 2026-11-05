"use client";

import { useEffect, useRef, useState } from "react";
import { Slider } from "@heroui/react";
import { buzz } from "@/lib/haptic";
import { playSound } from "@/lib/sound";
import { rubberBand, stretchAllowed } from "@/lib/sheetStops";
import { edgeOvershoot, tickStops } from "@/lib/sliderFeel";

/** One draggable thumb for a single number inside known limits (the discount percent). It sits beside the keypad,
 *  never instead of it: the keypad is for exact figures, this is for the quick coarse pick.
 *  While a finger holds it, the number rides above the thumb and the track stretches a little past either end;
 *  with `ticks`, each step is a notch that clicks and buzzes as the thumb passes it. */
export default function AmountSlider({
  label,
  min,
  max,
  step,
  value,
  format,
  onChange,
  onCommit,
  ticks = false,
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
  /** Show a notch at every step, with a click and a buzz as the thumb lands on one. */
  ticks?: boolean;
}) {
  const [held, setHeld] = useState(false);
  const [stretch, setStretch] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  // While held, follow the finger on the whole page: past the ends of the track the slider stretches.
  useEffect(() => {
    if (!held) return;
    const move = (e: PointerEvent) => {
      const r = trackRef.current?.getBoundingClientRect();
      if (!r || !stretchAllowed()) return;
      const over = edgeOvershoot(e.clientX, r.left, r.right);
      setStretch(Math.sign(over) * rubberBand(Math.abs(over), 16));
    };
    const up = () => {
      setHeld(false);
      setStretch(0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [held]);

  const shown = Math.min(max, Math.max(min, value));

  return (
    <Slider
      aria-label={label}
      minValue={min}
      maxValue={max}
      step={step}
      value={shown}
      onChange={(v) => {
        const n = v as number;
        if (ticks && n !== shown) {
          playSound("slider.snap");
          buzz(8);
        }
        onChange(n);
      }}
      onChangeEnd={(v) => onCommit?.(v as number)}
      className="w-full"
    >
      <div className="mb-[var(--space-1)] flex items-center justify-between text-[length:var(--text-xs)] text-[var(--text-muted)]">
        <span>{label}</span>
        <span className="tabular-nums text-[var(--text)]">{format(value)}</span>
      </div>
      <div
        ref={trackRef}
        className="amountslider"
        data-held={held || undefined}
        style={{ "--stretch": `${stretch}px` } as React.CSSProperties}
        onPointerDown={() => setHeld(true)}
      >
        <Slider.Track>
          <Slider.Fill />
          {ticks &&
            tickStops(min, max, step).map((s) => (
              <span key={s} aria-hidden className="amountslider__tick" style={{ insetInlineStart: `${s * 100}%` }} />
            ))}
          <Slider.Thumb>
            {held && (
              <span aria-hidden className="amountslider__bubble tabular-nums">
                {format(shown)}
              </span>
            )}
          </Slider.Thumb>
        </Slider.Track>
      </div>
    </Slider>
  );
}
