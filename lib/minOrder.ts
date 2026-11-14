/* F64 first slice: a company minimum for an order's total. Below it the order is still saved, but the rep says why.
 * Example: minimum 500,000, basket 320,000 -> belowMin true; the rep picks «مشتری همین‌قدر خواست». 0 = off. */
export const BELOW_MIN_REASONS = ["مشتری همین‌قدر خواست", "کنار سفارش دیگری می‌رود", "مشتری تازه است", "مدیر موافق بود"] as const;

export const belowMin = (total: number, min: number): boolean => min > 0 && total > 0 && total < min;

/** The reason as it is stored: trimmed and cut to 100 characters; null when empty. */
export const cleanReason = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);
