// Which link the runner should hand to the resolver next.
//
// This is the whole thesis of the feature in one pure function. Resolution is a
// cascade of escalating cost -- a lat/lng already in the URL settles in ~300ms, a
// Playwright page costs up to 12s, and a Nominatim lookup is capped at one per
// second for everyone. A flat queue gives every item equal visual weight, so the
// progress bar crawls while 70% of the batch could have been finished in seconds.
// Ordering cheapest-first makes the bar's shape *true*: it races through the easy
// tier, then visibly slows on the expensive tail, and that contrast is the honest
// signal the user is reading.
//
// Pure by construction: no I/O, no clock, no randomness. Given the same pending
// list it always returns the same pick, which is what makes it testable without a
// database, a network or a timer -- and what makes the ordering assertion in
// runner.test.ts meaningful rather than a race.

import { RESOLUTION_TIER } from "@/lib/leadImportMeta";
import type { LocationResolution } from "@/lib/db";

export interface SchedulableItem {
  id: number;
  ordinal: number;
  resolution: LocationResolution;
  /** When the runner last started this item, for the stall guard. Undefined if never. */
  startedAt?: number;
}

/** The cost tiers, cheapest first. An item that could be settled by a plain fetch
 *  never waits behind one that needs a browser page. */
export const TIER_ORDER: LocationResolution[] = ["direct", "pluscode", "browser", "nominatim"];

/**
 * The next item to resolve, or undefined when nothing is pending.
 *
 * Cheapest tier first; within a tier, lowest ordinal first, so the list the user
 * watches fills roughly in paste order and the runner's behaviour is reproducible
 * rather than dependent on map iteration.
 */
export function nextItem<T extends SchedulableItem>(pending: readonly T[]): T | undefined {
  if (pending.length === 0) return undefined;
  let best = pending[0];
  let bestTier = RESOLUTION_TIER[best.resolution];
  for (let i = 1; i < pending.length; i++) {
    const cand = pending[i];
    const tier = RESOLUTION_TIER[cand.resolution];
    if (tier < bestTier || (tier === bestTier && cand.ordinal < best.ordinal)) {
      best = cand;
      bestTier = tier;
    }
  }
  return best;
}

/** The pending items in the order the runner will work through them: cheapest tier
 *  first, paste order within each. Lets a test assert the whole plan, not one pick. */
export function plannedOrder<T extends SchedulableItem>(pending: readonly T[]): T[] {
  return [...pending].sort((a, b) => {
    const tier = RESOLUTION_TIER[a.resolution] - RESOLUTION_TIER[b.resolution];
    if (tier !== 0) return tier;
    return a.ordinal - b.ordinal;
  });
}

/** How many pending items still need the browser or the geocoder -- what the panel
 *  shows as "۱۲ مورد" beside the current method, so the reason for a slow patch of
 *  the bar is always on screen. */
export function remainingByTier<T extends SchedulableItem>(
  pending: readonly T[]
): Record<LocationResolution, number> {
  const counts = {
    direct: 0,
    pluscode: 0,
    browser: 0,
    nominatim: 0,
    manual: 0,
    unresolved: 0,
  } as Record<LocationResolution, number>;
  for (const item of pending) counts[item.resolution]++;
  return counts;
}

/** The most expensive thing still outstanding -- what the headline names.
 *
 *  Deliberately the *last* item in the plan, not the next one. The next item is
 *  always the cheapest (that is the point of ordering), so naming it would report
 *  "direct" while a hundred links still need a browser, which is precisely the lie
 *  this feature exists to stop. If anything remains that needs Chromium, the honest
 *  sentence is "a browser is opening", even while a cheap link is being fetched. */
export function currentMethod<T extends SchedulableItem>(
  pending: readonly T[]
): LocationResolution | null {
  if (pending.length === 0) return null;
  let worst = pending[0];
  for (let i = 1; i < pending.length; i++) {
    if (RESOLUTION_TIER[pending[i].resolution] > RESOLUTION_TIER[worst.resolution]) {
      worst = pending[i];
    }
  }
  return worst.resolution;
}
