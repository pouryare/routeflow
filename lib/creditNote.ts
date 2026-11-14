/* B1 + F12: a credit note for goods that came back after delivery. The reasons a manager picks from; the note on the payment says which. */
export const CREDIT_NOTE_REASONS = [
  { id: "damaged", label: "خراب‌شده" },
  { id: "expired", label: "تاریخ‌گذشته" },
  { id: "wrong_item", label: "کالای اشتباه" },
  { id: "refused", label: "مشتری نپذیرفت" },
  { id: "other", label: "دلیل دیگر" },
] as const;

export const isCreditNoteReason = (v: unknown): v is (typeof CREDIT_NOTE_REASONS)[number]["id"] => CREDIT_NOTE_REASONS.some((r) => r.id === v);

/** B1: whether this role may pay `amount` back in cash with the company's `limit`: an owner any amount, anyone else up to the limit. */
export const mayRefundCash = (isOwnerRole: boolean, amount: number, limit: number): boolean => amount > 0 && (isOwnerRole || amount <= limit);
