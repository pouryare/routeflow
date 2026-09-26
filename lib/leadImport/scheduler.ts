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
import { extractLatLng, extractPlusCodeCoords } from "@/lib/geoLinks";
import type { LocationResolution } from "@/lib/db";

/** How expensive a link is *expected* to be, judged from the URL alone.
 *
 *  This exists because of a bug the runner test caught. `lead_import_items.resolution`
 *  defaults to "unresolved" and is only filled in *after* the link has been resolved, so
 *  a queue of untouched items is uniformly tier 3 -- ordering by the stored resolution
 *  ranked every pending link as equally expensive and the cheapest-first rule never
 *  fired at pickup time. The scheduler's own unit test passed, because it was fed
 *  realistic resolutions the real queue does not have yet.
 *
 *  So the order is decided by what the URL promises, which is knowable up front and
 *  costs nothing: a link whose coordinates are already in the slug needs one cheap
 *  fetch, one that only carries a Plus Code the same, and anything else may need a
 *  browser page and then the rate-limited geocoder. Pure -- it parses a string. */
export function predictTier(url: string): number {
  if (extractLatLng(url)) return 0;
  if (extractPlusCodeCoords(url)) return 0;
  return 1;
}

export interface SchedulableItem {
  id: number;
  ordinal: number;
  /** The pasted link. Carries the promise the order is based on -- see predictTier. */
  maps_url: string;
  resolution: LocationResolution;
  /** When the runner last started this item, for the stall guard. Undefined if never. */
  startedAt?: number;
}

/** The cost rank used for ordering.
 *
 *  The URL's promise wins, because that is what is knowable before the work starts. A
 *  recorded resolution is only consulted for links whose URL looks identical -- taking
 *  the cheaper of the two would let a stale "direct" on a link that actually needs a
 *  browser page pull it ahead of honest work, which is the ordering this whole module
 *  exists to get right. */
function rankOf(item: SchedulableItem): number {
  const predicted = predictTier(item.maps_url);
  if (predicted === 0) return 0;
  return RESOLUTION_TIER[item.resolution];
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
  let bestTier = rankOf(best);
  for (let i = 1; i < pending.length; i++) {
    const cand = pending[i];
    const tier = rankOf(cand);
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
    const tier = rankOf(a) - rankOf(b);
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
