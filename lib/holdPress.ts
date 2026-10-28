/** Press-and-hold confirmation for actions that cannot be undone: how far a hold has got, and whether
 *  a key may start one. Pure, so the timing is tested without a browser. */

export const HOLD_MS = 1500;

/** 0 to 1: how much of the hold has been done after `elapsedMs`. */
export function holdProgress(elapsedMs: number, holdMs = HOLD_MS): number {
  if (!(holdMs > 0)) return 1;
  return Math.min(1, Math.max(0, elapsedMs / holdMs));
}

/** Space and Enter hold a focused button the way a finger does; a repeat event is not a new press. */
export const startsHold = (key: string, repeat: boolean): boolean => !repeat && (key === " " || key === "Enter");
