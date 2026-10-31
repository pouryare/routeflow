/** Which sides of a sideways-scrolling row still have content beyond them. `scrollLeft` is 0 at the
 *  start edge, and negative once scrolled in a right-to-left row; `max` is scrollWidth - clientWidth. */
export function fadeSides(scrollLeft: number, max: number, rtl: boolean): { left: boolean; right: boolean } {
  if (max <= 1) return { left: false, right: false };
  return rtl
    ? { left: -scrollLeft < max - 1, right: -scrollLeft > 1 }
    : { left: scrollLeft > 1, right: scrollLeft < max - 1 };
}

/** Pixels per frame for a middle-button autoscroll, from how far the pointer is from where it was
 *  pressed: nothing inside a small dead zone, then growing with distance. */
export function autoscrollSpeed(dx: number): number {
  const dead = 12;
  return Math.abs(dx) <= dead ? 0 : (dx - Math.sign(dx) * dead) * 0.12;
}
