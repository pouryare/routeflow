/** Staff advances and loans: pure rules. One running balance per person.
 *  Example: Ali gets a 3,000,000 advance (balance 3,000,000), then a 1,000,000 claim of his is paid with 400,000 deducted:
 *  he receives 600,000 in cash and his balance falls to 2,600,000. */
export type LoanKind = "advance" | "deduction" | "repayment" | "writeoff";
export const LOAN_KIND_LABEL: Record<LoanKind, string> = {
  advance: "مساعده یا وام",
  deduction: "کسر از هزینهٔ تأییدشده",
  repayment: "بازپرداخت نقدی",
  writeoff: "بخشودگی",
};

export function loanBalance(entries: { kind: LoanKind; amountToman: number }[]): number {
  return entries.reduce((n, e) => n + (e.kind === "advance" ? e.amountToman : -e.amountToman), 0);
}

/** A problem with a new advance, in words; null when fine. `limit` 0 means advances are off. */
export function advanceProblem(i: { amountToman: number; balanceToman: number; limitToman: number }): string | null {
  if (!Number.isInteger(i.amountToman) || i.amountToman <= 0) return "مبلغ را به تومان و بدون اعشار وارد کنید";
  if (i.limitToman <= 0) return "مساعده در تنظیمات شرکت خاموش است";
  if (i.balanceToman + i.amountToman > i.limitToman) return "با این مبلغ، بدهی این نفر از سقف مساعده بیشتر می‌شود";
  return null;
}

/** How much of what we owe a person may be taken off against their loan: the lesser of the two, and what the manager chose. */
export function deductionProblem(i: { deductToman: number; owedToman: number; balanceToman: number }): string | null {
  if (!Number.isInteger(i.deductToman) || i.deductToman < 0) return "مبلغ کسر نامعتبر است";
  if (i.deductToman > i.owedToman) return "کسر نمی‌تواند از مبلغ قابل پرداخت بیشتر باشد";
  if (i.deductToman > i.balanceToman) return "کسر نمی‌تواند از مانده وام بیشتر باشد";
  return null;
}

/** True when a person still owes money and nothing has come back for `days` days (the last movement, or the advance itself). */
export function loanReminderDue(balanceToman: number, lastMoveIso: string, nowMs: number, days: number): boolean {
  const t = Date.parse(lastMoveIso);
  return balanceToman > 0 && Number.isFinite(t) && nowMs - t >= days * 86_400_000;
}
