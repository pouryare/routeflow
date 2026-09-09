/** One card's contextual help. Either real copy — what the chart/figure shows and how to
 *  read it — or a typed placeholder so an unwritten entry renders a calm "coming soon"
 *  line instead of throwing, and stays countable for the backlog. */
export type HelpEntry =
  | { id: string; title: string; what: string; how: string }
  | { id: string; todo: true };

export function isTodo(e: HelpEntry): e is { id: string; todo: true } {
  return "todo" in e;
}
