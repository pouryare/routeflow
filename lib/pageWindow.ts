/** Which page numbers a pager shows: the first, the last, the current page, and "…" where a run
 *  is skipped. Five slots at most, so with the two arrows every button keeps 44 px on a 390 px
 *  phone. Near an end it shows the three pages there instead of a lone "…".
 *  Example: page 6 of 20 → 1 … 6 … 20; page 2 of 20 → 1 2 3 … 20; page 19 of 20 → 1 … 18 19 20. */
export type PageSlot = number | "gap";

export function pageWindow(page: number, pageCount: number): PageSlot[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const p = Math.min(Math.max(1, page), pageCount);
  if (p <= 3) return [1, 2, 3, "gap", pageCount];
  if (p >= pageCount - 2) return [1, "gap", pageCount - 2, pageCount - 1, pageCount];
  return [1, "gap", p, "gap", pageCount];
}
