"use client";

import { useEffect } from "react";

/** Linear falloff from `peak` at distance 0 to `1` at `distance >= radius` -- the
 *  FloatingDock magnification-on-proximity curve (spec 2026-09-08 §9a), reduced to a
 *  pure function so the shape of the curve is unit-testable without a DOM. */
export function magnifyScale(
  distance: number,
  opts: { peak?: number; radius?: number } = {},
): number {
  const { peak = 1.35, radius = 72 } = opts;
  const d = Math.max(0, distance);
  if (d >= radius) return 1;
  const t = d / radius;
  return peak - (peak - 1) * t;
}

/** ONE delegated pointermove listener on the rail container, writing a distance-derived
 *  --dock-scale onto every [data-dock-item] descendant each frame -- same architecture
 *  as useTiltGlow (lib/design/tilt.ts): one listener regardless of item count, rAF-
 *  batched, gated to fine pointers, disabled under prefers-reduced-motion. Distance is
 *  measured along the rail's own vertical axis (item centre Y vs pointer Y), matching a
 *  vertical dock; a horizontal dock would measure X instead, which this rail never is.
 */
export function useDockMagnify(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduced.matches) return;

    let rafId: number | null = null;
    let pendingY: number | null = null;

    const applyFrame = () => {
      rafId = null;
      if (pendingY == null) return;
      const items = container.querySelectorAll<HTMLElement>("[data-dock-item]");
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const scale = magnifyScale(Math.abs(pendingY - centerY));
        item.style.setProperty("--dock-scale", String(scale));
      }
    };

    const onMove = (e: PointerEvent) => {
      pendingY = e.clientY;
      if (rafId == null) rafId = requestAnimationFrame(applyFrame);
    };

    const onLeave = () => {
      pendingY = null;
      const items = container.querySelectorAll<HTMLElement>("[data-dock-item]");
      for (const item of items) item.style.removeProperty("--dock-scale");
    };

    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerleave", onLeave);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [containerRef]);
}
