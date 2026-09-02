/** The Action Center ranking — a pure module, no `db` import.
 *
 *  Source §5: out of 1,000 orders ~30 need a human — critical / warning / opportunity,
 *  ranked by `Priority = Impact × Probability × Urgency`. "The manager should see 30,
 *  not 1,000." This module does the ranking; lib/repo/actionCenter gathers the
 *  candidates from six bounded queries.
 */

export type Bucket = "critical" | "warning" | "opportunity";

export interface Candidate {
  /** stable id, e.g. 'alert:42' | 'stalled_order:1007' | 'at_risk:cust:88' */
  key: string;
  kind:
    | "alert"
    | "stalled_order"
    | "at_risk_customer"
    | "stockout_risk"
    | "overdue_receivable"
    | "cross_sell";
  title_fa: string;
  sub_fa?: string;
  bucket: Bucket;
  /** 0–1, Toman at stake normalised */
  impact: number;
  /** 0–1, how sure the detection is */
  probability: number;
  /** 0–1, how time-sensitive */
  urgency: number;
  href?: string;
}

export interface RankedItem extends Candidate {
  priority: number;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

export function priorityScore(impact: number, probability: number, urgency: number): number {
  return clamp01(impact) * clamp01(probability) * clamp01(urgency);
}

const BUCKETS: Bucket[] = ["critical", "warning", "opportunity"];

/** Score every candidate, split by bucket, sort by priority within a bucket, keep the
 *  head of each. */
export function rankActionCenter(
  cands: Candidate[],
  capPerBucket = 12
): Record<Bucket, RankedItem[]> {
  const scored: RankedItem[] = cands.map((c) => ({
    ...c,
    priority: priorityScore(c.impact, c.probability, c.urgency),
  }));
  const out = { critical: [], warning: [], opportunity: [] } as Record<Bucket, RankedItem[]>;
  for (const b of BUCKETS) {
    out[b] = scored
      .filter((c) => c.bucket === b)
      .sort((x, y) => y.priority - x.priority)
      .slice(0, capPerBucket);
  }
  return out;
}
