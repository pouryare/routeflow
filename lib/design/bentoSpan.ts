/** Deterministic span assignment for a list of tiles whose count is only known at
 *  render time (a dynamic panel list, not a hand-laid-out page). Pairs tiles into
 *  wide(7)+narrow(5) rows -- 12 columns each, matching spec 2026-09-08 §9b's worked
 *  example of one wide table beside one narrow chart. A single tile, or one left over
 *  at the end of an odd-length list, spans the full row rather than sitting alone at
 *  half width with a hole beside it. */
export type BentoSpan = "full" | "wide" | "half" | "narrow";

export function bentoSpanForIndex(index: number, total: number): BentoSpan {
  if (total <= 1) return "full";
  const isLastOfOdd = total % 2 === 1 && index === total - 1;
  if (isLastOfOdd) return "full";
  return index % 2 === 0 ? "wide" : "narrow";
}
