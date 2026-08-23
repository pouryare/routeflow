"use client";

import { RefObject, useEffect } from "react";

/** Distance the thumb must travel before this counts as a swipe rather than a tap that
 *  wandered. */
const MIN_DISTANCE_PX = 60;

/** How much more horizontal than vertical the gesture has to be. Both panels this is
 *  used on scroll vertically, and a scroll that drifts sideways must not dismiss them. */
const DOMINANCE = 1.6;

/** Past this, it stops reading as a flick and starts reading as a drag that changed its
 *  mind. */
const MAX_DURATION_MS = 700;

/** Swipe a panel off the edge it came from.
 *
 *  Both panels enter from a screen edge and leave through a small ✕ in a corner --
 *  which on a phone means reaching across the panel with the thumb that is holding it.
 *  The gesture is what anything sliding in from an edge implies it supports.
 *
 *  Deliberately end-of-gesture only: no live drag, no rubber-banding. Tracking the panel
 *  to the finger means fighting the browser for the touch stream on an element that also
 *  scrolls, and getting that wrong costs the ability to scroll the panel at all -- a much
 *  worse outcome than an un-animated dismissal.
 *
 *  @param direction the way the panel leaves: "right" for one docked on the right edge.
 */
export function useSwipeDismiss(
  ref: RefObject<HTMLElement | null>,
  direction: "left" | "right",
  onDismiss: () => void,
  enabled = true
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let startX = 0;
    let startY = 0;
    let startedAt = 0;
    let tracking = false;

    function onStart(e: TouchEvent) {
      // Ignore anything multi-touch: that is a pinch or a two-finger scroll, and neither
      // is a dismissal.
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startedAt = Date.now();
      tracking = true;
    }

    function onEnd(e: TouchEvent) {
      if (!tracking) return;
      tracking = false;

      const touch = e.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (Date.now() - startedAt > MAX_DURATION_MS) return;
      if (Math.abs(dx) < MIN_DISTANCE_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * DOMINANCE) return;
      if (direction === "right" ? dx <= 0 : dx >= 0) return;

      onDismiss();
    }

    // Passive: this never calls preventDefault, and saying so up front lets the browser
    // keep scrolling on the compositor instead of waiting to see whether we will.
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", () => (tracking = false), { passive: true });

    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
    };
  }, [ref, direction, onDismiss, enabled]);
}
