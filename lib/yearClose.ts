/** H2 «بستن سال»: the year-end entry. Pure. Example: revenue 100 and expenses 60 in 1404 give Dr revenue 100,
 *  Cr expenses 60, Cr 3103 (retained earnings) 40; a loss of 10 puts 10 on the debit side of 3103. */
export interface YearAccount { accountId: number; type: "REVENUE" | "EXPENSE"; /** credits less debits, so revenue is positive */ net: number }
export interface YearLeg { accountId: number; side: "D" | "C"; amountToman: number }

export function yearCloseProblem(year: number, currentYear: number): string | null {
  if (!Number.isInteger(year) || year < 1300 || year > 1600) return "سال نامعتبر است";
  return year >= currentYear ? "سال جاری یا آینده بسته نمی‌شود؛ بعد از پایان سال ببندید" : null;
}

/** The legs that zero every revenue and expense account of the year and carry the profit to `retainedAccountId`. */
export function closingLegs(rows: YearAccount[], retainedAccountId: number): YearLeg[] {
  const legs: YearLeg[] = [];
  let profit = 0;
  for (const r of rows) {
    if (r.net === 0) continue;
    profit += r.net;
    // a positive net is a credit balance: clear it with a debit
    legs.push({ accountId: r.accountId, side: r.net > 0 ? "D" : "C", amountToman: Math.abs(r.net) });
  }
  if (profit !== 0) legs.push({ accountId: retainedAccountId, side: profit > 0 ? "C" : "D", amountToman: Math.abs(profit) });
  return legs;
}

/** SQL for «not the year-end entry nor its reversal»: the closing entry moves profit, it is not trading, so profit
 *  and loss reports leave it out. The balance sheet keeps it (it is how 3103 gets the profit). */
export const NOT_YEAR_CLOSE = `(j.source_type <> 'YEAR_CLOSE' AND NOT EXISTS (SELECT 1 FROM journals yc WHERE yc.id = j.reverses_journal_id AND yc.source_type = 'YEAR_CLOSE'))`;

