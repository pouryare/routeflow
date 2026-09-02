/** The rule engine's pure core: condition evaluation and the cooldown / escalation
 *  arithmetic. `lib/repo/rules.ts` does the DB side (which rules fire, what they create,
 *  the rule_runs bookkeeping).
 *
 *  Conditions are a flat AND list of {field, op, value} against a plain row (an event's
 *  metadata, or a sweep query's row). No nested boolean logic -- a rule that needs more
 *  gets a dedicated sweep query instead.
 *
 *  Pure -- no imports from lib/db / lib/repo.
 */

export type RuleOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "exists";

export interface RuleCondition {
  field: string;
  op: RuleOp;
  value?: unknown;
}

function get(row: Record<string, unknown>, field: string): unknown {
  // dotted path support: "customer.balance"
  return field.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
    return undefined;
  }, row);
}

function cmp(a: unknown, b: unknown): number | null {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

export function evaluateConditions(
  conds: RuleCondition[] | null | undefined,
  row: Record<string, unknown>
): boolean {
  if (!conds || conds.length === 0) return true;
  for (const c of conds) {
    const v = get(row, c.field);
    switch (c.op) {
      case "exists":
        if (c.value === false ? v !== undefined : v === undefined) return false;
        break;
      case "eq":
        if (v !== c.value) return false;
        break;
      case "ne":
        if (v === c.value) return false;
        break;
      case "in":
        if (!Array.isArray(c.value) || !c.value.includes(v)) return false;
        break;
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const d = cmp(v, c.value);
        if (d === null) return false;
        if (c.op === "gt" && !(d > 0)) return false;
        if (c.op === "gte" && !(d >= 0)) return false;
        if (c.op === "lt" && !(d < 0)) return false;
        if (c.op === "lte" && !(d <= 0)) return false;
        break;
      }
    }
  }
  return true;
}

export function cooldownUntil(firedAtIso: string, cooldownMin: number): string {
  return new Date(Date.parse(firedAtIso) + cooldownMin * 60_000).toISOString();
}

/** A rule_run is escalatable when it has an escalation window, is past it, and is
 *  neither escalated nor resolved. */
export function isEscalatable(
  run: { fired_at: string; escalated_at: string | null; resolved_at: string | null },
  escalateAfterMin: number | null | undefined,
  nowIso: string
): boolean {
  if (escalateAfterMin == null) return false;
  if (run.escalated_at || run.resolved_at) return false;
  return Date.parse(nowIso) - Date.parse(run.fired_at) >= escalateAfterMin * 60_000;
}
