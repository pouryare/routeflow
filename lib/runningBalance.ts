/** A statement's lines with the balance after each one, plus the closing balance.
 *
 *  `increases` is the side that adds to the balance: an account's normal side (debit for an
 *  asset, credit for what we owe a supplier). The other side subtracts. `opening` seeds the
 *  total for a statement that starts mid-history. Plain loop rather than a `map` with a
 *  captured accumulator, so there is no mutable variable shared with a callback. */
export function withRunningBalance<R extends { side: string; amountToman: number }>(
  rows: readonly R[],
  increases: "D" | "C",
  opening = 0
): { lines: (R & { balanceToman: number })[]; closingToman: number } {
  const lines: (R & { balanceToman: number })[] = [];
  let running = opening;
  for (const r of rows) {
    running += r.side === increases ? r.amountToman : -r.amountToman;
    lines.push({ ...r, balanceToman: running });
  }
  return { lines, closingToman: running };
}
