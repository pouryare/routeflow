import type { ChequeStatus } from "@/lib/chequeStates";

/** What each queue of quick decisions asks, and how a tap becomes a request. Pure, so the
 *  mapping is tested before any card exists. */

export interface DeckChoice {
  id: string;
  label: string;
  tone?: "good" | "bad";
}

/** Cheques that need a verdict soon: still in hand and due on or before `horizon` (overdue ones
 *  first). Ordered by due date. */
export function chequesDue<T extends { status: ChequeStatus; due_date: string }>(cheques: T[], horizon: string): T[] {
  return cheques.filter((c) => c.status === "in_hand" && c.due_date <= horizon).sort((a, b) => a.due_date.localeCompare(b.due_date));
}

export const CHEQUE_CHOICES: DeckChoice[] = [
  { id: "deposited", label: "به بانک سپرده شد", tone: "good" },
  { id: "bounced", label: "برگشت خورد", tone: "bad" },
];

export const chequeRequest = (to: string) => ({ action: "advance", to });

/** Complaints nobody has looked at yet. */
export const complaintsToTriage = <T extends { status: string }>(list: T[]): T[] => list.filter((c) => c.status === "open");

export const COMPLAINT_CHOICES: DeckChoice[] = [
  { id: "investigating", label: "در حال بررسی" },
  { id: "resolved", label: "رفع شد", tone: "good" },
  { id: "dismissed", label: "رد شد", tone: "bad" },
];

export const complaintRequest = (status: string) => ({ status });

/** Credit approvals: the manager's verdict on an order parked for exceeding a customer's limit.
 *  Rejecting is the destructive answer (tinted); its consequence is printed on the card, the way
 *  the order page's own confirm step prints it. */
export const CREDIT_CHOICES: DeckChoice[] = [
  { id: "approved", label: "تأیید اعتبار", tone: "good" },
  { id: "rejected", label: "رد درخواست", tone: "bad" },
];

export const creditRequest = (verdict: string) => ({ verdict });

export const CREDIT_CONSEQUENCE: Record<string, string> = {
  approved: "سفارش تأیید می‌شود و موجودی برایش رزرو می‌شود.",
  rejected: "سفارش متوقف می‌ماند تا لغو شود یا بدهی مشتری زیر سقف برگردد.",
};

/** Discount approvals: the group manager's or owner's verdict on a discount asked for on an order.
 *  Rejecting is the destructive answer (tinted); the order goes on at its full price. */
export const DISCOUNT_CHOICES: DeckChoice[] = [
  { id: "approved", label: "تأیید تخفیف", tone: "good" },
  { id: "rejected", label: "رد تخفیف", tone: "bad" },
];

export const discountRequest = (verdict: string) => ({ verdict });

export const DISCOUNT_CONSEQUENCE: Record<string, string> = {
  approved: "تخفیف روی سفارش اعمال می‌شود و سهم افراد از کمیسیونشان کم می‌شود.",
  rejected: "سفارش بدون تخفیف و با قیمت کامل ادامه می‌دهد.",
};

/** Duplicate customers: merge folds one record into the other (its orders, payments and history move
 *  across), «not the same» remembers that the pair was looked at and is not offered again. The
 *  merge is the destructive answer, so its consequence is printed on the card. */
export const DUP_CHOICES: DeckChoice[] = [
  { id: "merge", label: "ادغام شود", tone: "bad" },
  { id: "separate", label: "دو مشتری جدا هستند", tone: "good" },
];

export const dupRequest = (verdict: string, keepId: number, dropId: number) =>
  verdict === "merge" ? { action: "merge", keep_id: keepId, drop_id: dropId } : { action: "separate", a_id: keepId, b_id: dropId };

export const DUP_CONSEQUENCE: Record<string, string> = {
  merge: "سفارش‌ها، پرداخت‌ها و سابقهٔ مشتریِ دوم به مشتریِ اول منتقل می‌شود.",
  separate: "این دو دیگر به‌عنوان تکراری پیشنهاد نمی‌شوند.",
};
