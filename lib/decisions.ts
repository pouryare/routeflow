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
