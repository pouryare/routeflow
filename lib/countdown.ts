/** A countdown that can be stopped and started again without losing time.
 *
 *  The toast's lifetime used to be a bare `setTimeout`, which is fine for a message that
 *  only has to be read. It stops being fine once the toast carries the *only* undo: a
 *  fixed timer cannot be paused while someone reads a long Persian sentence, so the action
 *  they are deciding about disappears while they are deciding. Pausing needs the remaining
 *  time as state, and state that a timer id cannot hold.
 *
 *  Everything here is a pure function of an explicit `now`, so the behaviour is testable
 *  without fake timers and without a DOM -- and so a paused countdown is genuinely frozen
 *  rather than merely appearing to be, which a re-armed `setTimeout` is not.
 *
 *  **This also measures something real.** The bar it drives is not a progress animation:
 *  it is how long a queued mutation stays in the outbox before the sync engine takes it,
 *  which is exactly how long "undo" costs nothing. See docs/crm-erp-plan.md §4.6.
 */

export interface Countdown {
  /** The full duration, kept so progress has a denominator after a pause. */
  readonly totalMs: number;
  /** Time left as of `startedAt`; the whole duration for a countdown never yet run. */
  readonly remainingMs: number;
  /** When the current run began, or null while paused. */
  readonly startedAt: number | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function startCountdown(totalMs: number, now: number): Countdown {
  const total = Math.max(0, totalMs);
  // A zero or negative duration is already over. Starting it running would leave
  // `isElapsed` true and `startedAt` set, which reads as "running but finished".
  return { totalMs: total, remainingMs: total, startedAt: total === 0 ? null : now };
}

export function remainingMsAt(c: Countdown, now: number): number {
  if (c.startedAt === null) return c.remainingMs;
  return clamp(c.remainingMs - (now - c.startedAt), 0, c.remainingMs);
}

export function pauseCountdown(c: Countdown, now: number): Countdown {
  if (c.startedAt === null) return c;
  return { ...c, remainingMs: remainingMsAt(c, now), startedAt: null };
}

export function resumeCountdown(c: Countdown, now: number): Countdown {
  // Already running, or nothing left to run. Re-arming a finished countdown would hand
  // back time that has already been spent.
  if (c.startedAt !== null || c.remainingMs <= 0) return c;
  return { ...c, startedAt: now };
}

export function isElapsed(c: Countdown, now: number): boolean {
  return remainingMsAt(c, now) <= 0;
}

/** 1 at the start, 0 at the end -- the fraction of the toast's tone flood still standing.
 *  Drawn as the clip that eats the flood back toward the reading-start edge. */
export function progressAt(c: Countdown, now: number): number {
  if (c.totalMs <= 0) return 0;
  return clamp(remainingMsAt(c, now) / c.totalMs, 0, 1);
}

/** Snap progress to `steps` bands, for `prefers-reduced-motion`.
 *
 *  Rounds **up**: at 1% remaining the bar still shows one band rather than nothing, so it
 *  never reads as "expired" while the button is still live. */
export function quantise(progress: number, steps: number): number {
  if (!Number.isFinite(steps) || steps <= 0) return progress;
  return clamp(Math.ceil(progress * steps) / steps, 0, 1);
}

/** Whole seconds left, rounded up, for the button's accessible name.
 *
 *  Up, for the same reason as `quantise`: announcing "0 seconds" while the control still
 *  works tells a screen-reader user the opposite of the truth. */
export function secondsLeft(c: Countdown, now: number): number {
  return Math.ceil(remainingMsAt(c, now) / 1000);
}
