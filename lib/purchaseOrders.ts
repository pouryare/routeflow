/** F66: purchase orders. Pure rules.
 *  Example: an order for 100 and 50, 100 arrived and 20 of the second → "partly_received"; the rest stays open until
 *  it arrives or the owner closes the order short. */
export type PoStatus = "draft" | "ordered" | "partly_received" | "received" | "closed" | "cancelled";
export const PO_LABEL: Record<PoStatus, string> = {
  draft: "پیش‌نویس",
  ordered: "سفارش داده شد",
  partly_received: "بخشی رسیده",
  received: "رسیده",
  closed: "بسته با کسری",
  cancelled: "لغو شد",
};
export const PO_OPEN: readonly PoStatus[] = ["ordered", "partly_received"];

export interface PoLine { base_qty: number; received_qty: number }

export const remaining = (l: PoLine): number => Math.max(0, l.base_qty - l.received_qty);

/** The status after a receipt: everything in → received; something in → partly received; nothing in → unchanged. */
export function statusAfterReceipt(current: PoStatus, lines: PoLine[]): PoStatus {
  if (lines.length > 0 && lines.every((l) => remaining(l) === 0)) return "received";
  if (lines.some((l) => l.received_qty > 0)) return "partly_received";
  return current;
}

/** What may be done to an order in each status. */
export const PO_ACTIONS: Record<PoStatus, readonly ("send" | "cancel" | "close")[]> = {
  draft: ["send", "cancel"],
  ordered: ["cancel"],
  partly_received: ["close"],
  received: [],
  closed: [],
  cancelled: [],
};

/** The status an action leads to, or null when the order's status does not allow it. */
export function statusAfterAction(current: PoStatus, action: "send" | "cancel" | "close"): PoStatus | null {
  if (!PO_ACTIONS[current].includes(action)) return null;
  return action === "send" ? "ordered" : action === "cancel" ? "cancelled" : "closed";
}

/** Open and past its expected day. `today` is a Tehran day (YYYY-MM-DD). */
export const isLate = (status: PoStatus, expected: string | null, today: string): boolean =>
  PO_OPEN.includes(status) && expected !== null && expected < today;

export function poProblem(i: { expected_date: string | null; lines: { base_qty: number; unit_cost_toman: number }[] }): string | null {
  if (i.lines.length === 0) return "سفارش خرید بدون قلم ثبت نمی‌شود";
  if (i.expected_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(i.expected_date)) return "تاریخ رسیدن معتبر نیست";
  for (const l of i.lines) {
    if (!Number.isFinite(l.base_qty) || l.base_qty <= 0) return "تعداد باید بزرگ‌تر از صفر باشد";
    if (!Number.isInteger(l.unit_cost_toman) || l.unit_cost_toman < 0) return "قیمت را به تومان و بدون اعشار وارد کنید";
  }
  return null;
}

/** F87: which half of the expected day a delivery comes. */
export type ArrivalSlot = "morning" | "afternoon";
export const SLOT_LABEL: Record<ArrivalSlot, string> = { morning: "صبح", afternoon: "بعدازظهر" };
export const isSlot = (v: unknown): v is ArrivalSlot => v === "morning" || v === "afternoon";

/** The open orders due by `untilIso`, late ones first, then by day and slot (morning before afternoon, no slot last).
 *  Example: today Monday, orders expected Sunday (late), Monday morning, Monday (no slot), next Monday → the first three. */
export function arrivalsDue<T extends { expected_date: string | null; expected_slot: ArrivalSlot | null }>(orders: T[], untilIso: string): T[] {
  const slotRank = (s: ArrivalSlot | null) => (s === "morning" ? 0 : s === "afternoon" ? 1 : 2);
  return orders
    .filter((o) => o.expected_date !== null && o.expected_date <= untilIso)
    .sort((a, b) => a.expected_date!.localeCompare(b.expected_date!) || slotRank(a.expected_slot) - slotRank(b.expected_slot));
}

/** The gap between the price on the order and the price on the receipt, in whole percent; null when there is no order
 *  price (0 or missing) or the two are the same. Positive = the receipt is dearer.
 *  Example: ordered at 1,000, received at 1,100 → 10; at 900 → -10. */
export function priceGapPercent(orderedToman: number, receivedToman: number): number | null {
  if (!(orderedToman > 0) || !Number.isFinite(receivedToman) || receivedToman === orderedToman) return null;
  const pct = Math.round(((receivedToman - orderedToman) / orderedToman) * 100);
  return pct === 0 ? (receivedToman > orderedToman ? 1 : -1) : pct;
}
