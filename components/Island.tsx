"use client";

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

export type IslandTone = "good" | "warn" | "crit" | "accent" | "neutral";

const TONE_VAR: Record<IslandTone, string> = {
  good: "var(--good)",
  warn: "var(--warn)",
  crit: "var(--crit)",
  accent: "var(--accent)",
  neutral: "var(--text-muted)",
};

interface IslandProps {
  /** Expanded when true, a bare pill when false. The parent owns the timing. */
  open: boolean;
  tone?: IslandTone;
  /** The one element that survives the morph. Keep it to a glyph or a dot. */
  icon: ReactNode;
  /** Revealed only when open. Measured, so it may be any height. */
  children: ReactNode;
  className?: string;
}

const COLLAPSED_W = 52;
const COLLAPSED_H = 40;
const MAX_W = 420;

/** A pill that widens into a panel, and the same DOM node throughout.
 *
 *  **On animating width and height.** MASTER.md bans it, and that ban is right for the
 *  reason it gives -- those properties drive layout, so animating them on an element in
 *  the document flow re-lays-out its siblings sixty times a second. Neither half of that
 *  applies here. The island is `position: fixed`, so it has no siblings to disturb, and it
 *  carries `contain: layout paint size`, which tells the browser that nothing outside its
 *  box can be affected by what happens inside it. What is left is a single composited
 *  element changing its own box.
 *
 *  The alternative is worse rather than merely different. Morphing by `transform: scale`
 *  means scaling the text with the box and counter-scaling it back on the inner node,
 *  which is visibly wrong through the whole transit -- glyphs thicken and thin, and on a
 *  Persian face with connected letterforms the joins visibly break. A shape morph is the
 *  one case where the box itself is the thing being animated, so the box is what moves.
 *
 *  Height is measured rather than guessed: the content is laid out at its natural size in
 *  a wrapper that a ResizeObserver watches, and the island animates to whatever that
 *  reports. A hardcoded height is how these end up clipping the second line of a long
 *  message in the one language the layout was not tested in.
 */
export default function Island({
  open,
  tone = "accent",
  icon,
  children,
  className = "",
}: IslandProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: COLLAPSED_W, h: COLLAPSED_H });

  // Layout effect, not effect: this runs before paint, so the first opened frame is
  // already the right size rather than snapping a frame later.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      // COLLAPSED_W is the icon column, which sits beside the content rather than over
      // it, so the island is the icon plus whatever the content naturally wants.
      setSize({
        w: Math.min(MAX_W, COLLAPSED_W + Math.ceil(r.width)),
        h: Math.max(COLLAPSED_H, Math.ceil(r.height)),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div
      className={`island ${open ? "island--open" : ""} ${className}`}
      style={
        {
          "--island-tone": TONE_VAR[tone],
          width: open ? `${size.w}px` : `${COLLAPSED_W}px`,
          height: open ? `${size.h}px` : `${COLLAPSED_H}px`,
        } as React.CSSProperties
      }
    >
      <span className="island__icon" aria-hidden="true">
        {icon}
      </span>

      {/* Absolutely positioned so its own layout never depends on the animating box --
          the content sits at its natural size the entire time and the box travels past
          it, which is what stops the text reflowing on every frame of the morph. */}
      <div className="island__content">
        <div ref={contentRef} className="island__measure">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Drives the mount → expand → collapse → unmount cycle on a timer.
 *
 *  Split out because every caller wants the same shape: appear as a pill, widen almost
 *  immediately so the arrival reads as one motion rather than two, hold, then collapse
 *  before leaving. Only the durations differ.
 */
export function useIslandCycle(lifetimeMs: number, onDone: () => void) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // One frame as a pill. Long enough that the widening is visibly a morph and not just
    // a box appearing at full size; short enough that it never delays reading.
    const opening = window.setTimeout(() => setOpen(true), 30);
    const closing = window.setTimeout(() => setOpen(false), lifetimeMs);
    const done = window.setTimeout(onDone, lifetimeMs + 260);
    return () => {
      window.clearTimeout(opening);
      window.clearTimeout(closing);
      window.clearTimeout(done);
    };
  }, [lifetimeMs, onDone]);

  return open;
}
