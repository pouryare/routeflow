/** F45: rating a delivery. Pure rules.
 *  Example: a shop owner tells the rep «۲ ستاره، کالا دیر رسید»; the rep enters 2 with the reason «دیر رسید» and a follow-up call task appears. */
export const LOW_STARS = 2;
export const RATING_REASONS = ["دیر رسید", "کالا ناقص بود", "کالا آسیب دیده بود", "برخورد راننده", "قیمت یا فاکتور"] as const;

export const isLowRating = (stars: number): boolean => stars <= LOW_STARS;

export function ratingProblem(i: { stars: unknown; reason: unknown }): string | null {
  if (typeof i.stars !== "number" || !Number.isInteger(i.stars) || i.stars < 1 || i.stars > 5) return "امتیاز باید از ۱ تا ۵ باشد";
  if (i.reason != null && (typeof i.reason !== "string" || i.reason.length > 100)) return "دلیل از ۱۰۰ نویسه بیشتر است";
  return null;
}
