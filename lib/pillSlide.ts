/** The sliding selection pill (bottom bar, page tabs, day chips).
 *
 *  The pill is drawn on the NEW selection the moment it changes; this plays it in from
 *  where the old one was. On the way it stretches to cover both places and then lets go of
 *  the old one, like the pill is pulled across rather than teleported -- the eye follows it
 *  to where you went. Pure transforms on the new pill (FLIP), so layout never moves. */

export type Box = { left: number; top: number; width: number };

/** The three moments of the slide, as boxes in the same coordinates: where it was, the
 *  stretch that covers both, where it lands. */
export function stretchPath(from: Box, to: Box): [Box, Box, Box] {
  const left = Math.min(from.left, to.left);
  const right = Math.max(from.left + from.width, to.left + to.width);
  const mid = { left, top: (from.top + to.top) / 2, width: right - left };
  return [from, mid, to];
}

/** `box` drawn as a transform of the pill that sits at `to`, scaled from its left edge. */
export function boxTransform(box: Box, to: Box): string {
  const scale = to.width > 0 ? box.width / to.width : 1;
  return `translate(${box.left - to.left}px, ${box.top - to.top}px) scaleX(${scale})`;
}

/** Plays the slide on the pill at `to` (an element, or its ::before with `pseudo`). A no-op
 *  with no previous box, when nothing moved, and under reduced motion. */
export function slidePill(el: Element, from: Box | null | undefined, to: Box, pseudo?: "::before") {
  if (!from || (from.left === to.left && from.top === to.top && from.width === to.width)) return;
  if (typeof el.animate !== "function") return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const frames = stretchPath(from, to).map((b, i) => ({
    transform: boxTransform(b, to),
    transformOrigin: "left center",
    offset: [0, 0.45, 1][i],
  }));
  el.animate(frames, {
    duration: 460,
    // --spring-snap: a little overshoot as it lands.
    easing: "cubic-bezier(0.34, 1.26, 0.64, 1)",
    pseudoElement: pseudo,
  });
}

/** An element's box in viewport coordinates, as slidePill wants it. */
export function boxOf(el: Element): Box {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width };
}
