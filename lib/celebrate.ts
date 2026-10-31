/** A short confetti burst for a milestone (the last stop of a route, the first order of the
 *  day). The library loads only when a burst fires, so no page pays for it up front. Skipped
 *  under reduced motion. */
export async function celebrate(): Promise<void> {
  if (typeof window === "undefined") return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { default: confetti } = await import("canvas-confetti");
  const shot = { particleCount: 60, spread: 70, startVelocity: 38, ticks: 260, gravity: 0.7, drift: 0.4, decay: 0.92, scalar: 1.1, flat: true, shapes: ["square" as const], disableForReducedMotion: true, zIndex: 2000 };
  void confetti({ ...shot, angle: 60, origin: { x: 0, y: 0.75 } });
  void confetti({ ...shot, angle: 120, origin: { x: 1, y: 0.75 } });
}
