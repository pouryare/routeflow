/** The heights a sheet over a map can rest at, and the stretch a sheet shows when it is pulled
 *  past its full height. Pure, so the gesture rules are tested (tests/sheetStops.test.ts).
 *
 *  Example: the map's customer sheet opens at «half». Drag its handle down and it drops to «peek»
 *  (just the shop's name, the map free above it); drag down again and it closes. Drag it up to
 *  «full»; keep pulling and it stretches a few pixels, then springs back. */

export type SheetStop = "peek" | "half" | "full";

const ORDER: SheetStop[] = ["peek", "half", "full"];

/** A finger that moved less than this was a tap, not a drag. */
export const TAP_PX = 8;
/** A drag this long moves the sheet one stop. */
export const STEP_PX = 40;

/** Where the sheet goes after the handle is let go, `dy` px below where it was pressed (negative
 *  is up). A tap goes up one stop, and from full back to half. */
export function nextStop(from: SheetStop, dy: number): SheetStop | "close" {
  const i = ORDER.indexOf(from);
  if (Math.abs(dy) < TAP_PX) return from === "full" ? "half" : ORDER[i + 1];
  if (dy <= -STEP_PX) return ORDER[Math.min(i + 1, ORDER.length - 1)];
  if (dy >= STEP_PX) return i === 0 ? "close" : ORDER[i - 1];
  return from;
}

/** One stop lower, for a swipe down on the sheet's body. Below peek, it closes. */
export function stopBelow(from: SheetStop): SheetStop | "close" {
  const i = ORDER.indexOf(from);
  return i === 0 ? "close" : ORDER[i - 1];
}

/** How far a sheet stretches when pulled `pull` px past its full height: one for one at first,
 *  then harder and harder, never past `max`. */
export function rubberBand(pull: number, max = 40): number {
  if (pull <= 0) return 0;
  return (max * pull) / (pull + max);
}

/** Whether the stretch plays right now: off with the effects switch (data-fx="off", lib/fx.ts)
 *  and with reduced motion. */
export function stretchAllowed(): boolean {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.fx === "off") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
