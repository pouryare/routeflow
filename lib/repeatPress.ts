/** Hold-to-repeat for count buttons («زیاد», «کم»): how long a finger waits before the count starts
 *  running, and how fast it runs after that. Pure, so the timing is tested without a browser. */

/** A tap is one step; only a hold longer than this starts repeating. */
export const REPEAT_FIRST_MS = 420;

/** Gap before repeat number `n` (1 is the first repeat): starts at 170 ms and speeds up to 60 ms. */
export function repeatInterval(n: number): number {
  return Math.max(60, 170 - (n - 1) * 14);
}
