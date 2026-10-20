import { faNum } from "@/lib/format";

/** «۳٫۷م» rather than «۳٬۷۲۶٬۵۰۰ تومان». A bar label has about six characters of room
 *  before it collides with its neighbour, and the exact figure is a tap away in the
 *  tooltip and spelled out in the data table underneath.
 *
 *  Everything from a hundred thousand upward is expressed in millions, including
 *  «۰٫۸م». Switching unit partway down a chart -- thousands for the short bars,
 *  millions for the tall ones -- makes two bars look comparable when one is a thousand
 *  times the other, which is the single worst thing a chart can do.
 */
export function compactToman(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${faNum(Math.round(n / 100_000_000) / 10)} میلیارد`;
  if (abs >= 100_000) return `${faNum(Math.round(n / 100_000) / 10)}م`;
  return faNum(n);
}

export const EMPTY_CHART = "هنوز داده‌ای برای این نمودار نیست";
