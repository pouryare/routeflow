import type { CustomerLifecycle } from "@/lib/types";
import type { SalesStage } from "./vocab";

const RANK: Record<SalesStage, number> = {
  unknown: 0, not_interested: 0, lost: 0,
  interested: 1, sample: 2, quotation: 3, negotiation: 4,
  first_order: 5, customer: 6, repeat_customer: 7,
};
export const stageRank = (s: SalesStage): number => RANK[s];

/** Leads may go cold and return. Call outcomes never demote existing customers. */
export function advanceStage(cur: SalesStage, next: SalesStage | null): SalesStage {
  if (!next || next === cur) return cur;
  const isCustomer = RANK[cur] >= 5;
  if (next === "not_interested" || next === "lost") return isCustomer ? cur : next;
  if (cur === "unknown" || cur === "not_interested" || cur === "lost") return next;
  return RANK[next] > RANK[cur] ? next : cur;
}

/** Preserve credit blocks; dormant businesses reactivate on an order-stage fact. */
export function lifecycleFor(stage: SalesStage, current: CustomerLifecycle): CustomerLifecycle {
  if (current === "blocked") return current;
  if (current === "dormant" && RANK[stage] < 5) return current;
  switch (stage) {
    case "unknown":
    case "not_interested":
      return "lead";
    case "interested":
    case "quotation":
    case "negotiation":
      return "qualified";
    case "sample":
      return "sampled";
    case "lost":
      return "lost";
    default:
      return "active";
  }
}
