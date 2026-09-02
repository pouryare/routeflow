/** Learned capacity factors — a pure module, no `db` import.
 *
 *  Phase 6 shipped *measured* defaults per weather condition. This learns per-tenant
 *  corrections from what the tenant's own completed routes actually did: an observed
 *  factor per run, EWMA-folded into the `capacity_factors.learned_*` columns.
 *  `lib/repo/capacityLearning` does the folding; the resolved value only overrides the
 *  configured one once there are enough observations to trust it.
 */

/** actual ÷ planned, or null when there is nothing to divide by. */
export function observedFactor(planned: number, actual: number): number | null {
  return planned > 0 ? actual / planned : null;
}

/** Fold one observation into a running EWMA. First observation seeds it. */
export function ewmaUpdate(prev: number | null | undefined, obs: number, alpha = 0.25): number {
  if (prev == null) return obs;
  return prev + alpha * (obs - prev);
}

/** 0 → 1 as observations accumulate; `full` observations = full confidence. */
export function blendConfidence(n: number, full = 10): number {
  return Math.max(0, Math.min(1, n / full));
}
