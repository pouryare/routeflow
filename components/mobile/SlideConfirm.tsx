"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/meridian/Icon";
import { SLIDE_DONE, slideProgress } from "@/lib/slideConfirm";
import { buzz } from "@/lib/haptic";
import { playSound } from "@/lib/sound";

/** Slide to confirm, for the big moments that are hard to take back (owner, 2026-11-05):
 *  the driver's «تحویل شد», a large payment, closing a month. Drag the knob from the start
 *  of the track to the end; let go short and it springs back. At the end the track fills and
 *  the knob turns into a check. A slide cannot happen by a bump in a pocket.
 *
 *  It is still a button: Enter or Space on it, or a screen reader's activate, confirms in one
 *  step, so the gesture is never the only way. No bencho block code: built from the idea. */
export default function SlideConfirm({
  children,
  sub,
  onConfirm,
  isDisabled,
  heavy,
}: {
  /** What sliding does («تحویل شد · کل مبلغ»). */
  children: ReactNode;
  sub?: ReactNode;
  onConfirm: () => void;
  isDisabled?: boolean;
  /** Money: plays the heavy «thump» instead of the plain done sound. */
  heavy?: boolean;
}) {
  const track = useRef<HTMLButtonElement>(null);
  const from = useRef<{ x: number; travel: number; rtl: boolean } | null>(null);
  const [p, setP] = useState(0);
  const [done, setDone] = useState(false);

  const finish = () => {
    if (done) return;
    setP(1);
    setDone(true);
    buzz(heavy ? [20, 40, 30] : 18);
    playSound(heavy ? "money.heavy" : "action.done");
    window.setTimeout(onConfirm, 260); // let the check land before the step moves on
  };

  return (
    <button
      ref={track}
      type="button"
      className="slideconfirm"
      data-done={done || undefined}
      disabled={isDisabled}
      aria-label={typeof children === "string" ? `${children} (بکشید تا تأیید شود)` : undefined}
      style={{ ["--p" as string]: p, touchAction: "none" }}
      onPointerDown={(e) => {
        if (done || isDisabled || !track.current) return;
        const r = track.current.getBoundingClientRect();
        const knob = r.height; // the knob is a circle as tall as the track
        from.current = { x: e.clientX, travel: r.width - knob, rtl: getComputedStyle(track.current).direction === "rtl" };
        track.current.setPointerCapture(e.pointerId);
        playSound("slide.moving");
      }}
      onPointerMove={(e) => {
        const f = from.current;
        if (f) setP(slideProgress(e.clientX - f.x, f.travel, f.rtl));
      }}
      onPointerUp={() => {
        if (!from.current) return;
        from.current = null;
        if (p >= SLIDE_DONE) finish();
        else setP(0);
      }}
      onPointerCancel={() => {
        from.current = null;
        setP(0);
      }}
      onClick={(e) => {
        // A pointer press is handled above; a click with no pointer travel is the keyboard or a screen reader.
        if (e.detail === 0) finish();
      }}
    >
      <span className="slideconfirm__fill" aria-hidden="true" />
      <span className="slideconfirm__label">
        {done ? "ثبت شد" : children}
        {sub && !done ? <small>{sub}</small> : null}
      </span>
      <span className="slideconfirm__knob" aria-hidden="true">
        <Icon name={done ? "check" : "arrow-left"} size="md" className={done ? "done-check" : undefined} />
      </span>
    </button>
  );
}
