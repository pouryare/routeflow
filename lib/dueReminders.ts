/** A8: reminder days around an order's due date. Pure. Example: "-3,0,3" means three days before, on the day, and three
 *  days after. On 10 March a day of -3 fires for orders due 13 March; a day of +3 fires for those due 7 March. */
export const REMINDER_CHOICES = [-7, -3, -1, 0, 1, 3, 7] as const;

export function parseDays(value: string | null | undefined): number[] {
  return [...new Set((value ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && Math.abs(n) <= 30 && (value ?? "").trim() !== ""))].sort((a, b) => a - b);
}

export const serializeDays = (days: number[]): string | null => (days.length ? parseDays(days.join(",")).join(",") : null);

/** The due date whose reminder falls today for this offset. */
export function dueDateFor(todayIso: string, offset: number): string {
  const d = new Date(`${todayIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export function reminderTitle(customer: string, offset: number): string {
  const when = offset === 0 ? "امروز سررسید است" : offset < 0 ? `${-offset} روز تا سررسید` : `${offset} روز از سررسید گذشته`;
  return `پیگیری پرداخت ${customer}: ${when}`;
}
