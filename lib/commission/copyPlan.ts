import type { Plan, PlanMode, CommissionMetric, RateType } from "@/lib/commission/tiers";

/** "Copy from…" for a commission plan: start the editor from a plan that already exists and change
 *  only what differs, instead of typing every tier again. Pure: the page supplies the stored plans
 *  and names, the editor receives rows it can edit. */
export interface PlanSource {
  /** "company" or the person's user id, as a string. */
  id: string;
  label: string;
  plan: Plan;
}

export interface TierRowInput {
  from: string;
  to: string;
  rate: string;
  type: RateType;
}

export interface EditablePlan {
  mode: PlanMode;
  metric: CommissionMetric;
  rows: TierRowInput[];
}

/** The latest plan per person (and the company default), company first, then by name. A person
 *  without a name in `names` is left out rather than shown as a bare number. */
export function latestPlans(
  stored: { salesperson_user_id: number | null; valid_from: string; mode: PlanMode; metric: CommissionMetric; tiers: Plan["tiers"] }[],
  names: ReadonlyMap<number, string>,
): PlanSource[] {
  const newest = new Map<string, (typeof stored)[number]>();
  for (const p of stored) {
    const key = p.salesperson_user_id === null ? "company" : String(p.salesperson_user_id);
    const cur = newest.get(key);
    if (!cur || p.valid_from > cur.valid_from) newest.set(key, p);
  }
  const out: PlanSource[] = [];
  for (const [id, p] of newest) {
    const label = id === "company" ? "پیش‌فرض شرکت" : names.get(Number(id));
    if (label) out.push({ id, label, plan: { mode: p.mode, metric: p.metric, tiers: p.tiers } });
  }
  return out.sort((a, b) => (a.id === "company" ? -1 : b.id === "company" ? 1 : a.label.localeCompare(b.label, "fa")));
}

/** The editor's rows for a plan: numbers as plain strings, the last tier open-ended. */
export function planToEditable(plan: Plan): EditablePlan {
  const last = plan.tiers.length - 1;
  return {
    mode: plan.mode,
    metric: plan.metric,
    rows: plan.tiers.map((t, i) => ({
      from: String(t.from_value),
      to: i === last || t.to_value === null ? "" : String(t.to_value),
      rate: String(t.rate_value),
      type: t.rate_type,
    })),
  };
}
