import { CHEQUE_TRANSITIONS, type ChequeStatus } from "@/lib/chequeStates";

/** Picking several rows to act on together. A long press on a row starts it; from then a tap
 *  toggles a row, and a bar offers the actions that make sense for what is picked. Pure, so which
 *  rows an action will really touch is decided (and tested) before anything is sent. */
export function toggleId(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Of the selected cheques, the ids that may move to `to` (the server's own transition table).
 *  The rest are left alone and counted, so the bar can say «۲ مورد انجام نمی‌شود». */
export function chequeBulk<T extends { id: number; status: ChequeStatus }>(
  cheques: T[],
  selected: ReadonlySet<number>,
  to: ChequeStatus,
): { ids: number[]; skipped: number } {
  const picked = cheques.filter((c) => selected.has(c.id));
  const ids = picked.filter((c) => CHEQUE_TRANSITIONS[c.status].includes(to)).map((c) => c.id);
  return { ids, skipped: picked.length - ids.length };
}
