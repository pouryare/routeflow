/** Slide to confirm (owner, 2026-11-05): drag the knob to the far end to say yes, for the
 *  three big moments -- «تحویل شد», a large payment, closing a month. Pure, so it is tested. */

/** How far along the track the knob must be let go for it to count. */
export const SLIDE_DONE = 0.9;

/** A payment of this much or more is confirmed by sliding instead of a tap.
 *  shortcut: one fixed amount for every company; make it a company setting when an owner asks. */
export const LARGE_PAYMENT_TOMAN = 50_000_000;

/** 0 to 1: how far the knob has travelled. `dx` is the finger's move since it went down; in a
 *  right-to-left page the knob starts on the right and travels left, so a move left is progress. */
export function slideProgress(dx: number, travel: number, rtl: boolean): number {
  if (!(travel > 0)) return 0;
  return Math.min(1, Math.max(0, (rtl ? -dx : dx) / travel));
}

/** Whether an option asks for a slide: always, or once the typed amount reaches `over`. */
export function wantsSlide(slide: true | { over: number } | undefined, amount: number): boolean {
  if (slide === undefined) return false;
  return slide === true || (Number.isFinite(amount) && amount >= slide.over);
}
