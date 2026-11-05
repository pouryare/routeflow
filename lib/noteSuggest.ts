/** Finishing a note from the person's own past ones: the ones that start with what is typed so far,
 *  the most often used first, then the most recent. No AI; it only repeats what they wrote before. */
export function noteSuggestions(typed: string, past: string[], max = 3): string[] {
  const t = typed.trim();
  if (!t) return [];
  const seen = new Map<string, { n: number; first: number }>();
  past.forEach((raw, i) => {
    const s = raw.trim();
    if (!s || s === t || !s.startsWith(t)) return;
    const hit = seen.get(s);
    if (hit) hit.n += 1;
    else seen.set(s, { n: 1, first: i });
  });
  // `past` is newest first, so a lower first index is more recent.
  return [...seen.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first).slice(0, max).map(([s]) => s);
}
