/** E5: may the person who entered something still undo it themselves?
 *  Example: a payment taken at 10:00 with a 15-minute window can be voided by its taker until 10:15; after that a manager does it. */
export function withinUndoWindow(enteredAtIso: string, nowMs: number, minutes: number): boolean {
  const t = Date.parse(enteredAtIso);
  if (!Number.isFinite(t) || minutes <= 0) return false;
  return nowMs - t >= -60_000 && nowMs - t <= minutes * 60_000;
}

/** Payments the taker may undo: cash-like receipts only; a cheque or a credit note has its own books. */
export const SELF_UNDO_METHODS = ["CASH", "POS", "CARD_TO_CARD", "OTHER"];
