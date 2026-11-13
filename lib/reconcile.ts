/** A3: the arithmetic of a hand reconcile. An asset account (cash, bank) grows on the debit side. */
export const signedAmount = (side: "D" | "C", amountToman: number) => (side === "D" ? amountToman : -amountToman);

/** What is left between the counted balance and the lines ticked so far (already locked ones included). Zero means done. */
export const reconcileGap = (countedToman: number, lockedToman: number, tickedToman: number) => countedToman - lockedToman - tickedToman;
