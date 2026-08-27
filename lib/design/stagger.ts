/** Entrance delays for a group of elements.
 *
 *  The cap is the whole point. A stagger that keeps counting past ten items stops
 *  reading as rhythm and starts reading as lag -- see MASTER.md, Motion, Tier 0.
 */
export function staggerDelays(
  count: number,
  step = 55,
  cap = 10,
  reduced = false
): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    reduced ? 0 : Math.min(i, cap) * step
  );
}
