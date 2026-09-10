import { getDb } from "@/lib/db";
import { FULFILLED_ORDER_STATUSES, sqlStatusList } from "@/lib/orderStateMachine";

/** The band, in the language the app is written in.
 *
 *  `band` is a three-value enum in English and it was reaching the page raw — «good» in
 *  the middle of a Persian sentence, alongside the raw `stage` enum next to it. A field
 *  is either an identifier or copy; this map is what turns one into the other.
 */
export const REP_HEALTH_BAND_FA: Record<RepHealth["band"], string> = {
  good: "خوب",
  watch: "نیازمند پیگیری",
  risk: "پرخطر",
};

export interface RepHealth {
  representative_id: number;
  score: number;
  band: "good" | "watch" | "risk";
  factors: { onboarding: number; recency: number; coverage: number };
  onboarding_done: number;
  onboarding_total: number;
  last_order_date: string | null;
  products_covered: number;
  products_available: number;
}

const W = { onboarding: 0.3, recency: 0.4, coverage: 0.3 };
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** recency: 100 for an order in the last 14 days, linear to 0 at 60 days, 0 beyond. */
function recencyScore(lastOrder: string | null, nowIso: string): number {
  if (!lastOrder) return 0;
  const days = (Date.parse(nowIso) - Date.parse(lastOrder)) / 86_400_000;
  if (days <= 14) return 100;
  if (days >= 60) return 0;
  return clamp(Math.round((1 - (days - 14) / 46) * 100));
}

export function repHealth(organizationId: number, representativeId: number): RepHealth {
  const db = getDb();
  const now = new Date().toISOString();

  const rep = db
    .prepare("SELECT customer_id FROM representative_profiles WHERE id = ? AND organization_id = ?")
    .get(representativeId, organizationId) as { customer_id: number } | undefined;
  const customerId = rep?.customer_id ?? -1;

  const steps = db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS done FROM representative_onboarding_steps WHERE representative_id = ?"
    )
    .get(representativeId) as { total: number; done: number | null };
  const onboardingTotal = steps.total ?? 0;
  const onboardingDone = steps.done ?? 0;
  const onboarding = onboardingTotal === 0 ? 100 : Math.round((onboardingDone / onboardingTotal) * 100);

  const lastOrder = (
    db
      .prepare(
        `SELECT MAX(order_date) AS d FROM orders WHERE customer_id = ? AND status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`
      )
      .get(customerId) as { d: string | null }
  ).d;

  const available = (
    db
      .prepare("SELECT COUNT(*) AS n FROM products WHERE (organization_id = ? OR organization_id IS NULL) AND active = 1")
      .get(organizationId) as { n: number }
  ).n;
  const covered = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT ol.product_id) AS n FROM order_lines ol JOIN orders o ON o.id = ol.order_id
          WHERE o.customer_id = ? AND o.status IN (${sqlStatusList(FULFILLED_ORDER_STATUSES)})`
      )
      .get(customerId) as { n: number }
  ).n;
  const coverage = available === 0 ? 0 : Math.round((covered / available) * 100);

  const recency = recencyScore(lastOrder, now);
  const score = Math.round(onboarding * W.onboarding + recency * W.recency + coverage * W.coverage);
  const band: RepHealth["band"] = score >= 70 ? "good" : score >= 40 ? "watch" : "risk";

  return {
    representative_id: representativeId,
    score,
    band,
    factors: { onboarding, recency, coverage },
    onboarding_done: onboardingDone,
    onboarding_total: onboardingTotal,
    last_order_date: lastOrder,
    products_covered: covered,
    products_available: available,
  };
}

export interface RepOverviewRow extends RepHealth {
  rep_code: string;
  business_name: string;
  stage: string;
}

export function repsOverview(organizationId: number): RepOverviewRow[] {
  const reps = getDb()
    .prepare(
      `SELECT rp.id, rp.rep_code, rp.stage, c.business_name
         FROM representative_profiles rp JOIN customers c ON c.id = rp.customer_id
        WHERE rp.organization_id = ? ORDER BY rp.rep_code`
    )
    .all(organizationId) as { id: number; rep_code: string; stage: string; business_name: string }[];
  return reps.map((r) => ({
    ...repHealth(organizationId, r.id),
    rep_code: r.rep_code,
    business_name: r.business_name,
    stage: r.stage,
  }));
}
