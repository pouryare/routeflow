/* D3: close a small leftover. The reasons a manager picks from (the note on the payment says which). */
export const LEFTOVER_REASONS = [
  { id: "rounding", label: "گردکردن" },
  { id: "bank_fee", label: "کارمزد بانک" },
  { id: "small_discount", label: "تخفیف کوچک" },
  { id: "other", label: "دلیل دیگر" },
] as const;
export type LeftoverReason = (typeof LEFTOVER_REASONS)[number]["id"];

export const isLeftoverReason = (v: unknown): v is LeftoverReason => LEFTOVER_REASONS.some((r) => r.id === v);

/** Whether this role may close `amount` with the company's `limit`: an owner any amount that is owed, anyone else
 *  up to the limit. Pure so the screen and the server read the same rule. */
export function mayCloseLeftover(isOwnerRole: boolean, amount: number, limit: number): boolean {
  return amount > 0 && (isOwnerRole || amount <= limit);
}
