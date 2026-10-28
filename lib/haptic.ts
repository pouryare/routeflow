/** A short buzz where the phone has one; a no-op elsewhere (iOS Safari has no vibrate). */
export function buzz(ms = 12): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(ms);
  }
}
