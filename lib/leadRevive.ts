/** S16: how long a lost lead rests before it returns to the pool, by the reason it was lost. Reasons not listed
 *  (wrong contact, closed business) never return. Example: lost for «قیمت بالاست» on day 0 → back on day 60. */
import { LOST_REASON_LABEL, type LostReason } from "./crm/vocab";

const REVIVE_DAYS: Partial<Record<LostReason, number>> = {
  PRICE_HIGH: 60,
  HAS_SUPPLIER: 120,
  NO_NEED: 180,
  SEASONAL: 90,
  PAYMENT_TERMS: 60,
  DELIVERY: 60,
  MOQ: 90,
  QUALITY: 120,
  BUYS_FACTORY: 120,
  BUYS_DISTRIBUTOR: 120,
  COMPETITOR: 120,
  OTHER: 180,
};

/** Whole days a lead must rest, or null when it never returns. */
export function reviveAfterDays(reason: string | null, overrides: Partial<Record<string, number>> = {}): number | null {
  if (!reason) return null;
  const d = overrides[reason] ?? REVIVE_DAYS[reason as LostReason];
  return typeof d === "number" && d > 0 ? d : null;
}

export function reviveDue(reason: string | null, lastActivityIso: string, now: Date, overrides?: Partial<Record<string, number>>): boolean {
  const days = reviveAfterDays(reason, overrides);
  return days !== null && now.getTime() - Date.parse(lastActivityIso) >= days * 86_400_000;
}

export const reasonLabel = (r: string): string => LOST_REASON_LABEL[r as LostReason] ?? r;
