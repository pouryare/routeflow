"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/** Ease-out cubic: fast at the start, settling gently. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/** The value a count-up from `from` to `target` shows `elapsedMs` into a `durationMs`
 *  run. Pure, so the animation maths is testable without a DOM; the hook below is a thin
 *  rAF wrapper over it. A non-positive duration (or reduced motion, handled in the hook)
 *  lands on `target` immediately.
 */
export function countUpValue(
  from: number,
  target: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return target;
  if (elapsedMs <= 0) return from;
  return from + (target - from) * easeOutCubic(elapsedMs / durationMs);
}

/** Animates a number from its previous value up to `target` on mount and on change.
 *
 *  Returns `target` unchanged when the OS asks for reduced motion or when running on the
 *  server, so a figure is never briefly wrong for a reader who cannot see it settle.
 */
export function useCountUp(target: number, opts: { durationMs?: number } = {}): number {
  const durationMs = opts.durationMs ?? 600;
  const reduced = usePrefersReducedMotion();
  // null → not animating, so the hook returns `target` verbatim (the reduced-motion and
  // SSR case, and every moment outside a run). setState happens only inside the rAF
  // callback below, never synchronously in the effect body.
  const [animated, setAnimated] = useState<number | null>(null);
  const fromRef = useRef(target);

  useEffect(() => {
    if (reduced || durationMs <= 0 || !Number.isFinite(target)) {
      fromRef.current = target;
      return;
    }
    const from = fromRef.current;
    if (from === target) return;

    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed < durationMs) {
        setAnimated(countUpValue(from, target, elapsed, durationMs));
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setAnimated(null);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs, reduced]);

  return animated ?? target;
}
