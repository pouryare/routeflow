/** A short buzz where the phone has one; a no-op elsewhere (iOS Safari has no vibrate).
 *  A pattern (on, off, on… in ms) is for a "no": two short knocks read as a refusal. */
export function buzz(ms: number | number[] = 12): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(ms);
  }
}
