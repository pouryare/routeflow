import { clamp } from "@/lib/math";
/** Churn scoring — a pure module, no `db` import.
 *
 *  A small logistic model over five features. It ships with hand-set, recency-dominated
 *  weights (`DEFAULT_CHURN_WEIGHTS`) so a brand-new tenant gets a sensible "silent past
 *  their own cadence = probably gone" score before it has a single lapse to learn from.
 *  `churnStep` is one online-SGD update; `lib/repo/churn` folds a labelled set of real
 *  lapses through it once there are enough to matter.
 */

export interface ChurnFeatures {
  /** days since last order ÷ their own mean interval */
  recency_ratio: number;
  /** this-quarter orders ÷ prior-quarter orders (1 = flat) */
  trend: number;
  /** months since the customer's first order */
  tenure_months: number;
  complaints_90d: number;
  /** 30+ day debt ÷ trailing revenue */
  overdue_ratio: number;
}

export type ChurnWeights = { bias: number } & Record<keyof ChurnFeatures, number>;

export const DEFAULT_CHURN_WEIGHTS: ChurnWeights = {
  bias: -1.2,
  recency_ratio: 1.1,
  trend: -0.8,
  tenure_months: -0.3,
  complaints_90d: 0.5,
  overdue_ratio: 0.7,
};

/** Clamp + scale the raw features into the vector the linear combination sees.
 *  `trend` is centred at 1 (a flat customer contributes 0); `tenure_months` is scaled
 *  to years. */
function normalise(f: ChurnFeatures): Record<keyof ChurnFeatures, number> {
  return {
    recency_ratio: clamp(f.recency_ratio, 0, 5),
    trend: clamp(f.trend, 0, 3) - 1,
    tenure_months: clamp(f.tenure_months, 0, 36) / 12,
    complaints_90d: Math.max(0, f.complaints_90d),
    overdue_ratio: clamp(f.overdue_ratio, 0, 2),
  };
}

export function logistic(z: number): number {
  const zc = clamp(z, -30, 30);
  return 1 / (1 + Math.exp(-zc));
}

const FEATURE_KEYS: (keyof ChurnFeatures)[] = [
  "recency_ratio",
  "trend",
  "tenure_months",
  "complaints_90d",
  "overdue_ratio",
];

export function churnScore(f: ChurnFeatures, w: ChurnWeights): number {
  const x = normalise(f);
  let z = w.bias;
  for (const k of FEATURE_KEYS) z += w[k] * x[k];
  return logistic(z);
}

/** One gradient step of log-loss. `label` is 1 for a customer who did lapse. */
export function churnStep(
  w: ChurnWeights,
  f: ChurnFeatures,
  label: 0 | 1,
  lr: number
): ChurnWeights {
  const x = normalise(f);
  const err = churnScore(f, w) - label;
  const next: ChurnWeights = { ...w, bias: w.bias - lr * err };
  for (const k of FEATURE_KEYS) next[k] = w[k] - lr * err * x[k];
  return next;
}

export function churnBand(p: number): "low" | "watch" | "high" {
  if (p >= 0.6) return "high";
  if (p >= 0.3) return "watch";
  return "low";
}

const REASON_FA: Partial<Record<keyof ChurnFeatures, string>> = {
  recency_ratio: "مدت‌هاست از ریتم خرید همیشگی عقب افتاده",
  trend: "روند سفارش‌هایش نزولی است",
  complaints_90d: "شکایت کیفی باز دارد",
  overdue_ratio: "بدهی معوق دارد",
};

/** The feature pushing the score up the most, as a sentence. */
export function churnReason(f: ChurnFeatures): string {
  const x = normalise(f);
  let best: keyof ChurnFeatures | null = null;
  let bestContribution = 0;
  for (const k of FEATURE_KEYS) {
    const c = DEFAULT_CHURN_WEIGHTS[k] * x[k];
    if (c > bestContribution && REASON_FA[k]) {
      bestContribution = c;
      best = k;
    }
  }
  return best ? REASON_FA[best]! : "بدون سیگنال مشخص";
}
