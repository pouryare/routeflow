import type { HelpEntry } from "./types";
export { isTodo } from "./types";
export type { HelpEntry };

/** Contextual help copy, keyed by a stable id a card passes to `<CardHelp id=… />`.
 *  Persian. Add entries here as cards adopt the `(i)` trigger — an id with no entry is
 *  safe (renders «راهنمای این بخش به‌زودی») and is reported by `todoHelpIds()`.
 *
 *  Seeded with the highest-traffic dashboard figures; the long tail lands in Part 2 as
 *  the trigger is rolled out. */
export const HELP: Record<string, Extract<HelpEntry, { title: string }>> = {
  "dashboard.revenue": {
    id: "dashboard.revenue",
    title: "درآمد دوره",
    what: "جمع مبلغ سفارش‌های تأییدشدهٔ بازهٔ انتخاب‌شده، بدون احتساب سفارش‌های لغوشده.",
    how: "با دورهٔ قبل مقایسه کنید. افت بیش از ۱۵٪ را در کنار «سفارش‌های باز» بررسی کنید.",
  },
  "dashboard.outstanding": {
    id: "dashboard.outstanding",
    title: "مانده بدهی",
    what: "مجموع بدهی مشتریان که سررسید آن گذشته است.",
    how: "ردیف‌های «بحرانی» را اول پیگیری کنید؛ رنگ قرمز یعنی بیش از ۹۰ روز.",
  },
  "dashboard.coverage": {
    id: "dashboard.coverage",
    title: "پوشش منطقه",
    what: "نسبت مشتریان فعال به کل مشتریان تعریف‌شده در هر منطقه.",
    how: "مناطق زیر ۶۰٪ نامزد بازدید هفتهٔ بعد هستند.",
  },
};

/** ids referenced by a mounted `<CardHelp>` that have no `HELP` entry yet. Populated at
 *  runtime as cards render; drives a "help debt" report. */
const seenTodo = new Set<string>();

export function getHelp(id: string): HelpEntry {
  const hit = HELP[id];
  if (hit) return hit;
  seenTodo.add(id);
  return { id, todo: true };
}

export function todoHelpIds(): string[] {
  return [...seenTodo].sort();
}

/** Test seam — clears the runtime todo set. */
export function __resetTodo(): void {
  seenTodo.clear();
}
