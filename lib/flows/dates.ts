/** `iso` (YYYY-MM-DD) moved by `days`, as ISO. Calendar arithmetic in UTC so a daylight-saving
 *  change can never turn "+30 days" into 29 or 31; the result is a date, not an instant. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** The "how long until it's due" shortcuts a cheque's due date is almost always one of.
 *  Offsets rather than named days: a cheque is post-dated by weeks or months, so the person
 *  thinks "a month from now", not "the 12th". The full calendar stays one tap away. */
export const DUE_PRESETS: { label: string; days: number }[] = [
  { label: "یک هفته دیگر", days: 7 },
  { label: "دو هفته دیگر", days: 14 },
  { label: "یک ماه دیگر", days: 30 },
  { label: "دو ماه دیگر", days: 60 },
  { label: "سه ماه دیگر", days: 90 },
];

/** Reminders are for the next few days far more often than for a date on the calendar. */
export const REMINDER_PRESETS: { label: string; days: number }[] = [
  { label: "امروز", days: 0 },
  { label: "فردا", days: 1 },
  { label: "دو روز دیگر", days: 2 },
  { label: "سه روز دیگر", days: 3 },
  { label: "یک هفته دیگر", days: 7 },
];

/** Shelf life is quoted in months, so the shortcuts are too. */
export const SHELF_PRESETS: { label: string; days: number }[] = [
  { label: "سه ماه دیگر", days: 90 },
  { label: "شش ماه دیگر", days: 180 },
  { label: "یک سال دیگر", days: 365 },
  { label: "دو سال دیگر", days: 730 },
];
