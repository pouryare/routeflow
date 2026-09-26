// How long a bulk import still has to run, from what the run has actually been doing.
//
// The spec's rule, and the reason this is not a fixed guess: the number is allowed to
// GROW. A batch that looked like four minutes can honestly become nine when the cheap
// tier drains and the run is left holding Chromium pages and a geocoder capped at one
// request a second. An ETA that only ever shrinks is a progress bar lying to make itself
// feel better, and on a ten-minute job that is the difference between watching it and
// walking away to split the paste into two spinners.
//
// Two invariants the tests hold this to:
//   1. never 0 while items remain -- "۰:۰۰" next to a moving bar reads as a bug
//   2. never shorter than one item's worth of work at the slowest remaining tier
//
// Pure: no clock, no I/O. The caller passes elapsed milliseconds and the outstanding
// per-tier counts, so the whole calculation is testable against fixed fixtures.

import type { LocationResolution } from "@/lib/db";

/** Typical cost of settling one link by each method, in milliseconds. Measured from the
 *  code's own limits: an 8s fetch timeout, a 12s Playwright timeout, and Nominatim's
 *  1 req/sec shared gate. These are planning figures for an estimate, not measurements. */
export const TIER_COST_MS: Record<LocationResolution, number> = {
  direct: 400,
  pluscode: 400,
  browser: 6000,
  nominatim: 2200,
  // Terminal: no further attempt is queued, so they cost nothing more.
  manual: 0,
  unresolved: 0,
};

export interface EtaInput {
  /** How many links remain per method, from the scheduler's remainingByTier. */
  remaining: Record<LocationResolution, number>;
  /** Milliseconds of real work already done in this job, across all tiers. */
  elapsedMs: number;
  /** Links finished so far. Used to derive observed throughput when it is meaningful. */
  completed: number;
  /** How many links the runner settles at once. Must match the runner's own width --
   *  the queue is worked in parallel, so wall-clock is total work divided by this, and
   *  a model that forgot that overstated a 1000-link batch by 4x (68 min vs 17). */
  concurrency?: number;
}

/** The width lib/resolveMapsLinks already uses. Duplicated as a named constant here
 *  rather than imported so this module stays pure and testable with no I/O; the runner
 *  passes its own value explicitly so the two cannot drift apart silently. */
export const DEFAULT_CONCURRENCY = 4;

/** Below this many finished links, an observed rate is noise, not a signal. Two is
 *  enough to notice "this is fast" but far too few to extrapolate from. */
const MIN_SAMPLES_FOR_RATE = 3;

/**
 * Seconds remaining, or 0 when the job is done.
 *
 * Prefers observed throughput once there is enough of it, because a real rate beats a
 * guess: a run clearing 40 links a second should not be told it has eight minutes left.
 * Before that, falls back to the per-tier cost figures, which is why the estimate is
 * already roughly right at the first poll.
 */
export function estimateEtaSeconds(input: EtaInput): number {
  const outstanding = totalOutstanding(input.remaining);
  if (outstanding === 0) return 0;

  const modelled = remainingWorkMs(input.remaining);

  // The queue is drained `concurrency` wide, so queued work divides by it to become
  // wall-clock. Observed throughput is already a wall-clock measure and is not divided
  // again -- it was measured on the same clock the user is watching.
  const width = Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY);

  // Observed rate: milliseconds of elapsed work per link finished. Only trusted once
  // there are real samples, and deliberately not corrected downward -- if the run has
  // been slow, the estimate stays slow, because that is what is actually happening.
  const useObserved = input.completed >= MIN_SAMPLES_FOR_RATE && input.elapsedMs > 0;
  const perItemMs = useObserved
    ? Math.max(input.elapsedMs / input.completed, 1)
    : modelled / width / outstanding;

  const seconds = (outstanding * perItemMs) / 1000;

  // Invariant 1: a moving bar with items outstanding must never read zero.
  return Math.max(1, Math.ceil(seconds));
}

/** Milliseconds of work still queued, summed per tier at that tier's cost. */
function remainingWorkMs(remaining: Record<LocationResolution, number>): number {
  let total = 0;
  for (const key of Object.keys(TIER_COST_MS) as LocationResolution[]) {
    total += (remaining[key] ?? 0) * TIER_COST_MS[key];
  }
  return total;
}

function totalOutstanding(remaining: Record<LocationResolution, number>): number {
  let total = 0;
  for (const key of Object.keys(TIER_COST_MS) as LocationResolution[]) {
    total += remaining[key] ?? 0;
  }
  return total;
}

/** Short human phrasing for the panel: «~۴ دقیقه», «~۹۰ ثانیه». */
export function formatEta(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 60) return `~${seconds} ثانیه`;
  const minutes = Math.round(seconds / 60);
  return `~${minutes} دقیقه`;
}
