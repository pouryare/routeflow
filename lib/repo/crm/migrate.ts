import type { ActivityFacts } from "@/lib/crm/replay";
import type { SalesStage, Temperature } from "@/lib/crm/vocab";

/** The activity columns the replay folds, as a SELECT list. */
export const ACTIVITY_FACT_COLUMNS =
  "occurred_at, contact_status_to, stage_to, verification_to, signal, attempt, miss, talked";

/** The starting facts of a business that existed before the CRM columns: what its lifecycle and
 *  delivered-order count imply (read by lib/repo/crm/state.ts). */
export function initialFacts(lifecycle: string, deliveredOrders: number, at: string): ActivityFacts {
  const lead = lifecycle === "lead";
  let stage: SalesStage;
  if (lead) stage = "unknown";
  else if (lifecycle === "qualified") stage = "interested";
  else if (lifecycle === "sampled") stage = "sample";
  else if (lifecycle === "lost") stage = "lost";
  else stage = deliveredOrders >= 2 ? "repeat_customer" : deliveredOrders === 1 ? "first_order" : "customer";
  const signal: Temperature | null = lifecycle === "qualified" ? "warm" : lifecycle === "sampled" ? "hot" : null;
  return {
    occurred_at: at,
    contact_status_to: lead ? null : "contacted",
    stage_to: stage === "unknown" ? null : stage,
    verification_to: lead ? "unverified" : "verified",
    signal,
    attempt: 0,
    miss: 0,
    talked: lead ? 0 : 1,
  };
}
