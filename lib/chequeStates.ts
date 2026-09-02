/** The lifecycle of a customer cheque, as a transition table.
 *
 *  A cheque is not a status you set -- it is a thing that moves through legal steps, and
 *  each step has a consequence: depositing it is a bank action, clearing it closes the
 *  matter, bouncing it re-opens the debt it was covering. Modelling the allowed moves in
 *  one place is what lets lib/repo/cheques enforce them without a tangle of `if`s, and
 *  what lets the board UI render exactly the buttons that are legal from where a cheque
 *  is now.
 *
 *  `issued` is the odd one out: it is a cheque *we* wrote, a stub for supplier payments
 *  in a later phase. Every customer cheque starts at `in_hand`.
 */

export type ChequeStatus =
  | "issued"
  | "in_hand"
  | "deposited"
  | "cleared"
  | "bounced"
  | "replaced"
  | "cancelled";

/** Where each status may legally go next. An empty array is terminal. */
export const CHEQUE_TRANSITIONS: Record<ChequeStatus, ChequeStatus[]> = {
  issued: ["in_hand", "cancelled"],
  in_hand: ["deposited", "bounced", "replaced", "cancelled"],
  deposited: ["cleared", "bounced"],
  cleared: [],
  bounced: ["replaced"],
  replaced: [],
  cancelled: [],
};

export function canAdvanceCheque(from: ChequeStatus, to: ChequeStatus): boolean {
  return CHEQUE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  issued: "صادرشده",
  in_hand: "در دست",
  deposited: "به بانک سپرده شد",
  cleared: "وصول شد",
  bounced: "برگشت خورد",
  replaced: "جایگزین شد",
  cancelled: "باطل شد",
};
