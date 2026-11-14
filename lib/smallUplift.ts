/* F65 first slice: below N packs the unit price goes up by P percent. Off when a pack has no rule or the order is waived.
 * Example: rule «below 5 packs, +10%», unit price 100,000: 3 packs -> unit 110,000; 5 packs -> 100,000. */
import { roundToman } from "@/lib/money";

export interface UpliftRule { smallPacks: number | null; percent: number | null }

/** The percent that applies to this many packs (0 when none). */
export function upliftPercentFor(packs: number, rule: UpliftRule | null, waived = false): number {
  if (waived || !rule || !rule.smallPacks || !rule.percent) return 0;
  return packs > 0 && packs < rule.smallPacks ? rule.percent : 0;
}

export const upliftedPrice = (unitPrice: number, percent: number): number => (percent > 0 ? roundToman(unitPrice * (1 + percent / 100)) : unitPrice);

/** The rule as saved: a pack count of 2 to 1000 and a percent of 1 to 100, both or neither. Words for the owner; null when fine. */
export function upliftRuleProblem(smallPacks: number | null, percent: number | null): string | null {
  if (smallPacks === null && percent === null) return null;
  if (smallPacks === null || percent === null) return "تعداد بسته و درصد را هر دو بنویسید یا هر دو را خالی بگذارید";
  if (!Number.isInteger(smallPacks) || smallPacks < 2 || smallPacks > 1000) return "تعداد بسته باید عددی بین ۲ تا ۱۰۰۰ باشد";
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) return "درصد باید عددی بین ۱ تا ۱۰۰ باشد";
  return null;
}
