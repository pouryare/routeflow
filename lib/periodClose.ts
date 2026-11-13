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
