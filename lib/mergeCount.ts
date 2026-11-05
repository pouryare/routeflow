import { faDigits } from "@/lib/format";

/** Matching messages join into one card instead of stacking copies (owner, 2026-11-05):
 *  the second «ثبت شد» turns the first into «ثبت شد ×۲». One message keeps its plain words. */
export function withCount(message: string, n: number): string {
  return n > 1 ? `${message} ×${faDigits(String(n))}` : message;
}

/** Several pings of one kind folded into one card: how many, and what they add up to. */
export function foldAmounts(items: { total_toman: number }[]): { count: number; total: number } {
  return { count: items.length, total: items.reduce((s, i) => s + i.total_toman, 0) };
}
