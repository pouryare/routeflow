/** The decision behind a swipe row, as a pure function so the gesture is testable without a
 *  finger. `dx`/`dy` are how far the pointer travelled since it went down (screen pixels,
 *  positive dx = to the right). The result names the SIDE by reading direction, because an action
 *  on the "start" side is where the eye begins: the right in Persian, the left in English.
 *
 *  A mostly-vertical gesture is a scroll, never a swipe: the page must keep scrolling under a
 *  finger that drifts sideways a little. */
export interface SwipeConfig {
  /** Past this the action is revealed (the row shows what releasing will do). */
  threshold: number;
  /** Past this, releasing runs the action. */
  commit: number;
  rtl: boolean;
}

export type SwipeResult =
  | { state: "idle" }
  | { state: "reveal"; side: "start" | "end" }
  | { state: "commit"; side: "start" | "end" };

export const SWIPE_DEFAULTS = { threshold: 72, commit: 140 } as const;

/** How long a finger must stay still on a row before it counts as a long press (selection). */
export const LONG_PRESS_MS = 450;

export function decide({ dx, dy = 0 }: { dx: number; dy?: number }, cfg: SwipeConfig): SwipeResult {
  if (Math.abs(dy) > Math.abs(dx) * 0.6) return { state: "idle" };
  const distance = Math.abs(dx);
  if (distance < cfg.threshold) return { state: "idle" };
  // Dragging right is the start side in RTL and the end side in LTR.
  const side: "start" | "end" = (dx > 0) === cfg.rtl ? "start" : "end";
  return distance >= cfg.commit ? { state: "commit", side } : { state: "reveal", side };
}
