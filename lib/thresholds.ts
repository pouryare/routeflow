/* D30: the numbers the app judges by, with the owner's say. Defaults are what the code used before.
 * Example: quiet_customer_days 45 -> 30 means a buying customer who has not ordered for 30 days shows on the
 * map's «ساکت» list. */
export const THRESHOLDS = [
  { key: "stalled_order_days", label: "سفارش گیرکرده", hint: "سفارش تأییدشده‌ای که این‌قدر روز تکان نخورده در «کارهای امروز» می‌آید", unit: "روز", def: 2, min: 1, max: 60 },
  { key: "quiet_customer_days", label: "مشتری ساکت", hint: "مشتری فعالی که این‌قدر روز سفارش نداده در فهرست نقشه می‌آید", unit: "روز", def: 45, min: 7, max: 365 },
  { key: "data_ageing_days", label: "داده در حال کهنه شدن", hint: "پس از این‌قدر روز از آخرین بارگذاری اکسل هشدار زرد می‌آید", unit: "روز", def: 7, min: 1, max: 90 },
  { key: "data_stale_days", label: "داده کهنه", hint: "پس از این‌قدر روز هشدار قرمز می‌آید (باید از مورد بالا بیشتر باشد)", unit: "روز", def: 14, min: 2, max: 180 },
  { key: "leftover_limit_toman", label: "سقف بستن مانده کوچک", hint: "مدیر تا این مبلغ می‌تواند مانده‌ای را با ذکر دلیل ببندد؛ بیشتر از آن را فقط مالک می‌بندد", unit: "تومان", def: 50000, min: 0, max: 100_000_000 },
  { key: "duplicate_order_hours", label: "هشدار سفارش تکراری", hint: "سفارش باز مشابهی که در این‌قدر ساعت اخیر ثبت شده هشدار می‌دهد", unit: "ساعت", def: 24, min: 1, max: 168 },
] as const;

type ThresholdKey = (typeof THRESHOLDS)[number]["key"];
export type Thresholds = Record<ThresholdKey, number>;

export const DEFAULT_THRESHOLDS: Thresholds = Object.fromEntries(THRESHOLDS.map((t) => [t.key, t.def])) as Thresholds;

/** The first problem with a full set of values, in words for the owner; null when all is well. */
export function thresholdsProblem(v: Thresholds): string | null {
  for (const t of THRESHOLDS) {
    const n = v[t.key];
    if (!Number.isInteger(n) || n < t.min || n > t.max) return `«${t.label}» باید عددی بین ${t.min} تا ${t.max} باشد`;
  }
  if (v.data_stale_days <= v.data_ageing_days) return "«داده کهنه» باید از «داده در حال کهنه شدن» بیشتر باشد";
  return null;
}
