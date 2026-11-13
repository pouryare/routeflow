/** A2 «بستن ماه»: which months may be closed. Pure. Example: on 3 Aban 1405 only months before Aban may be closed;
 *  a closed month is reopened only with a reason. */
export function mayClose(periodKey: string, currentKey: string): string | null {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) return "ماه نامعتبر است";
  if (periodKey >= currentKey) return "ماه جاری یا آینده بسته نمی‌شود؛ بعد از پایان ماه ببندید";
  return null;
}

export function reopenProblem(reason: string): string | null {
  const r = reason.trim();
  return r.length === 0 ? "برای بازکردن ماه دلیل را بنویسید" : r.length > 300 ? "دلیل خیلی بلند است" : null;
}

/** B2: an opening lasts a day. Example: opened at 10:00 it takes entries until 10:00 the next day. */
export const OPENING_HOURS = 24;

/** B2: the days of a closed month the owner opens, as numbers inside the month. Pure. */
export function openRangeProblem(fromDay: number, toDay: number, monthLength: number): string | null {
  if (!Number.isInteger(fromDay) || !Number.isInteger(toDay) || fromDay < 1 || toDay > monthLength) return `روزها باید بین ۱ و ${monthLength} باشند`;
  return fromDay > toDay ? "روز آغاز بعد از روز پایان است" : null;
}
