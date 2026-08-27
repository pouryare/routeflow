/** Which column of the pipeline an order belongs in.
 *
 *  A stage is DERIVED, not stored: `orders.status` has four values and one of them --
 *  confirmed -- covers both "priced and waiting" and "loaded onto a van", which are the
 *  two states anybody standing at the board actually wants told apart. The van is a row
 *  in delivery_stops, so the split is made here rather than by adding a fifth status and
 *  a migration to a table that already carries financial records.
 */
export type StageKey = "draft" | "confirmed" | "on_route" | "delivered";

export const STAGES: { key: StageKey; label: string; tone: string }[] = [
  { key: "draft", label: "پیش‌نویس", tone: "var(--text-faint)" },
  { key: "confirmed", label: "تأییدشده", tone: "var(--accent)" },
  { key: "on_route", label: "در مسیر", tone: "var(--info)" },
  { key: "delivered", label: "تحویل‌شده", tone: "var(--good)" },
];

export function stageOf(status: string, onRun: boolean): StageKey | null {
  if (status === "draft") return "draft";
  if (status === "delivered") return "delivered";
  if (status === "confirmed") return onRun ? "on_route" : "confirmed";
  // cancelled — off the board entirely. A lane for it would be a column of dead records
  // that never empties.
  return null;
}

/** Whether dragging from one lane to another may be carried out at all.
 *
 *  Exactly one transition in this system is a sales-side write: a draft becomes
 *  confirmed through PATCH /api/sales/orders/[id]. Loading onto a van is a delivery_stops
 *  row and settling is the driver's stop, both of which belong to other surfaces with
 *  their own authorisation. So the board refuses the rest WITH A REASON rather than
 *  accepting the drop and quietly reverting it on the next refresh.
 */
export function moveRefusal(from: StageKey, to: StageKey): string | null {
  if (from === to) return null;
  if (from === "draft" && to === "confirmed") return null;
  if (to === "draft") return "سفارش تأییدشده به پیش‌نویس برنمی‌گردد.";
  if (to === "on_route") return "بارگیری از صفحهٔ «مسیر تحویل» ثبت می‌شود.";
  if (to === "delivered") return "تحویل و تسویه را راننده سر درِ مغازه ثبت می‌کند.";
  return "این جابه‌جایی از اینجا انجام نمی‌شود.";
}

/** The lanes a card may legally be dropped into right now. */
export function allowedTargets(from: StageKey): StageKey[] {
  return STAGES.map((s) => s.key).filter((k) => moveRefusal(from, k) === null && k !== from);
}
