/** Which sides of a sideways-scrolling row still have content beyond them. `scrollLeft` is 0 at the
 *  start edge, and negative once scrolled in a right-to-left row; `max` is scrollWidth - clientWidth. */
export function fadeSides(scrollLeft: number, max: number, rtl: boolean): { left: boolean; right: boolean } {
  if (max <= 1) return { left: false, right: false };
  return rtl
    ? { left: -scrollLeft < max - 1, right: -scrollLeft > 1 }
    : { left: scrollLeft > 1, right: scrollLeft < max - 1 };
}
