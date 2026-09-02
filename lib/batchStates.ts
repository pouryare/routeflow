/** The lifecycle of a received batch, as a transition table.
 *
 *  `active` is sellable. `quarantined` is held back (FEFO skips it). `recalled` is a
 *  safety event — FEFO skips it and an alert fires to every customer who received the
 *  lot. `expired` and `depleted` are **computed** states: a sweep sets `expired` once
 *  `expiry_date` is past and `depleted` once on-hand reaches zero. The API path
 *  (`advanceBatchStatus`) allows only the manual moves; it refuses `expired`/`depleted`
 *  as "خودکار محاسبه می‌شود".
 */

export type BatchStatus = "active" | "quarantined" | "recalled" | "expired" | "depleted";

/** Where each status may legally move next. Empty is terminal. `depleted -> active`
 *  exists so a correcting RETURN_IN can revive a batch that was zeroed by mistake. */
export const BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  active: ["quarantined", "recalled", "expired", "depleted"],
  quarantined: ["active", "recalled", "depleted"],
  recalled: ["depleted"],
  expired: ["depleted"],
  depleted: ["active"],
};

export function canTransitionBatch(from: BatchStatus, to: BatchStatus): boolean {
  return BATCH_TRANSITIONS[from]?.includes(to) ?? false;
}

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  active: "فعال",
  quarantined: "قرنطینه",
  recalled: "فراخوان",
  expired: "منقضی",
  depleted: "تمام‌شده",
};
