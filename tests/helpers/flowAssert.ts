import { expect } from "vitest";
import { checkFlow, type FlowVariant } from "@/lib/crm/flows/validate";
import type { FlowConfig } from "@/lib/crm/flows/types";

/** docs/tap-flow-principles.md §6.4: no dead ends, the shortest path is within the declared
 *  common budget, the longest within the declared longest, and the declared budget itself
 *  honours §4 (5 / 9 by default; pass 7 / 12 for a capture flow). */
export function assertFlowBudget(
  cfg: FlowConfig,
  variants: FlowVariant[],
  cap: { common: number; longest: number } = { common: 5, longest: 9 },
) {
  const r = checkFlow(cfg, variants);
  expect(r.deadEnds).toEqual([]);
  expect(r.shortest).toBeLessThanOrEqual(cfg.budget.common);
  expect(r.longest).toBeLessThanOrEqual(cfg.budget.longest);
  expect(cfg.budget.common).toBeLessThanOrEqual(cap.common);
  expect(cfg.budget.longest).toBeLessThanOrEqual(cap.longest);
}

/** Every static option label is real copy, not a code: rejects SCREAMING_CASE and snake_case.
 *  Dynamic `options` functions are exercised by `checkFlow`; this inspects static ones only. */
export function assertNoRawEnumLabels(cfg: FlowConfig) {
  for (const s of Object.values(cfg.steps)) {
    const opts = typeof s.options === "function" ? [] : s.options;
    for (const o of opts) expect(o.label).not.toMatch(/^[A-Z][A-Z_]+$|^[a-z]+_[a-z_]+$/);
  }
}
