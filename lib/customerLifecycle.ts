import type { CustomerLifecycle } from "@/lib/types";

/** The lifecycle a customer may move to from where they are now.
 *
 *  Forward path: lead -> qualified -> sampled -> active. Plus re-engagement
 *  (lost -> lead), sleep/wake (active <-> dormant), and blocking from anywhere.
 *  A skip (lead -> sampled) is not allowed -- qualification is a real step. */
export const LIFECYCLE_TRANSITIONS: Record<CustomerLifecycle, CustomerLifecycle[]> = {
  lead: ["qualified", "lost", "blocked"],
  qualified: ["sampled", "active", "lost", "blocked"],
  sampled: ["active", "lost", "blocked"],
  active: ["dormant", "lost", "blocked"],
  dormant: ["active", "lost", "blocked"],
  lost: ["lead", "blocked"],
  blocked: ["active"],
};

export function canTransition(from: CustomerLifecycle, to: CustomerLifecycle): boolean {
  return LIFECYCLE_TRANSITIONS[from]?.includes(to) ?? false;
}
