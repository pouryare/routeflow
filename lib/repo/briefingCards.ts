/** Which items on the briefing DEMAND something, and the one to act on first.
 *
 *  Pure, with no database and no React, because "what does this screen say is urgent" is a
 *  decision and decisions deserve tests that run in milliseconds. `briefing.ts` builds the
 *  panels; this decides which of them count.
 *
 *  The rule that makes the screen work is what is EXCLUDED:
 *
 *  - `info` is not a demand. "۳ سفارش امروز" is information; counting it as work would put a
 *    number on the hero the reader cannot act on, which is worse than no number.
 *  - `good` is never urgent. A completed thing does not need doing, and leading with it
 *    teaches the reader to ignore the one number that matters.
 *  - an item with no `href` cannot be tapped, so it cannot be "the one to act on" either —
 *    it would be a card that looks actionable and goes nowhere.
 *  - an item with NO tone is not a demand either. `tone` is optional on BriefingItem, so
 *    "unspecified" is the most likely accidental way for the count to inflate.
 */

import type { BriefingItem, BriefingPanel } from "./briefing";

/** The tones that mean "this is waiting on you". `warn` and `crit` only. */
const DEMANDING: ReadonlySet<BriefingItem["tone"]> = new Set(["warn", "crit"]);

/** How many demanding rows a panel actually SHOWS. */
function demandingShown(p: BriefingPanel): number {
  return p.items.filter((i) => DEMANDING.has(i.tone)).length;
}

function demandingItems(panels: readonly BriefingPanel[]): BriefingItem[] {
  return panels.flatMap((p) => p.items.filter((i) => DEMANDING.has(i.tone)));
}

/** How many things are waiting on the reader. The one number on the hero.
 *
 *  Counts `more` as well as the rows on screen. `briefing.ts` caps a panel at five and puts
 *  the remainder in `more`, so a reader with twelve outstanding orders is shown five of them
 *  — and counting only what is rendered would tell them they have five. The number has to
 *  mean "waiting on you", and what is hidden is still waiting.
 *
 *  `more` is attributed to the panel as a whole rather than to a tone: the panel was already
 *  on screen because at least one of its rows was demanding, and the hidden rows are more of
 *  the same work. */
export function needsAttention(panels: readonly BriefingPanel[]): number {
  return panels.reduce((total, p) => total + demandingShown(p) + (p.more ?? 0), 0);
}

/** The single item to act on first, or `null` when nothing is both urgent and tappable.
 *
 *  Worst tone wins; within a tone the first listed wins, because `briefing.ts` already
 *  orders panels by how much they matter (credit approvals before unplanned routes).
 *
 *  An empty-string href counts as no destination, not as a destination to "/" — a card that
 *  navigates nowhere is worse than one that does not render. */
export function mostUrgent(panels: readonly BriefingPanel[]): BriefingItem | null {
  const candidates = demandingItems(panels).filter((i) => typeof i.href === "string" && i.href !== "");
  if (candidates.length === 0) return null;
  const worst = candidates.some((i) => i.tone === "crit") ? "crit" : "warn";
  return candidates.find((i) => i.tone === worst) ?? null;
}

export interface BriefingCard {
  count: number;
  /** The one item to act on, or null when every urgent item is untappable. */
  urgent: BriefingItem | null;
}

export function cardFor(panels: readonly BriefingPanel[]): BriefingCard | null {
  const count = needsAttention(panels);
  if (count === 0) return null;
  return { count, urgent: mostUrgent(panels) };
}