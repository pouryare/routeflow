"use client";

import { useEffect } from "react";

/** Pointer position within a box, normalized to 0..1 on each axis and clamped -- used by
 *  both the tilt (rotateX/Y) and the glow (radial-gradient position) math. */
export function normalizedPointerPosition(
  clientX: number,
  clientY: number,
  rect: DOMRect | { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  const x = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
  const y = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** rotateY's sign must flip under RTL or a card tilts away from the cursor instead of
 *  toward it. Written to the --tilt-dir custom property once per direction change, not
 *  recomputed per pointer move. */
export function tiltDirection(dir: "ltr" | "rtl"): 1 | -1 {
  return dir === "ltr" ? 1 : -1;
}

/** ONE delegated pointermove listener per container, updating CSS custom properties on
 *  whichever single descendant is currently under the pointer -- never per-card React
 *  state, never one listener per card. At 40 cards on screen this is still exactly one
 *  listener and, per frame, exactly one element's style getting two properties written.
 *
 *  Touch/coarse pointers get nothing: there is no hover on a phone, and tilt/glow are
 *  desktop-only. prefers-reduced-motion disables it entirely.
 */
export function useTiltGlow(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduced.matches) return;

    let active: HTMLElement | null = null;
    let rafId: number | null = null;
    let pendingEvent: PointerEvent | null = null;

    const release = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.removeProperty("--mx");
      el.style.removeProperty("--my");
      el.style.willChange = "";
    };

    const applyFrame = () => {
      rafId = null;
      const e = pendingEvent;
      if (!e || !active) return;
      const rect = active.getBoundingClientRect();
      const { x, y } = normalizedPointerPosition(e.clientX, e.clientY, rect);
      active.style.setProperty("--mx", String(x));
      active.style.setProperty("--my", String(y));
    };

    const onMove = (e: PointerEvent) => {
      const target = (e.target as HTMLElement).closest<HTMLElement>("[data-tilt]");
      if (target !== active) {
        release(active);
        active = target;
        if (active) active.style.willChange = "transform";
      }
      if (!active) return;
      pendingEvent = e;
      if (rafId == null) rafId = requestAnimationFrame(applyFrame);
    };

    const onLeave = () => {
      release(active);
      active = null;
    };

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      if (rafId != null) cancelAnimationFrame(rafId);
      release(active);
    };
  }, [containerRef]);
}
