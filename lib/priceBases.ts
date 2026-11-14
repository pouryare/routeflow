/** D14: price = base number × factor, rounded to the nearest 1,000 toman. Pure rules.
 *  Example: butter 410,000 per kg × 0.25 for the 250 g pack = 102,500, which rounds to 103,000. */
export const roundTo1000 = (n: number): number => Math.round(n / 1000) * 1000;

export const priceFromBase = (baseToman: number, factor: number): number => roundTo1000(baseToman * factor);

export function baseProblem(i: { name: string; valueToman: number }): string | null {
  if (i.name.trim().length === 0 || i.name.trim().length > 60) return "نام قیمت پایه را بنویسید (تا ۶۰ نویسه)";
  if (!Number.isSafeInteger(i.valueToman) || i.valueToman < 0) return "عدد پایه باید تومان و بدون اعشار باشد";
  return null;
}

export const factorProblem = (f: unknown): string | null =>
  typeof f === "number" && Number.isFinite(f) && f > 0 && f <= 100000 ? null : "ضریب باید عددی بیشتر از صفر باشد";
