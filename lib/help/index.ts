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
  /* PAGE-level entries. The three below the fold are FIGURE-level: they explain one number
   * inside the dashboard. These explain what the page IS, and they are what a card's (i)
   * trigger opens when a page declares `help` in lib/pageMeta.ts. */
  "page.dashboard": {
    id: "page.dashboard",
    title: "این صفحه چه چیزی را نشان می‌دهد",
    what: "خلاصهٔ فروش برای بازهٔ انتخابی: درآمد، بدهی‌های سررسیدشده و پوشش هر منطقه، کنار هم.",
    how: "بازه را از نوار بالا عوض کنید. روی هر عدد راهنما بزنید تا توضیح همان عدد را ببینید، نه توضیح صفحه.",
  },
  "page.orders": {
    id: "page.orders",
    title: "این صفحه چه چیزی را نشان می‌دهد",
    what: "همهٔ سفارش‌ها با وضعیت فعلی‌شان. «تأییدشده» یعنی فروش قطعی است؛ «لغوشده» یعنی برگشته و در درآمد نمی‌آید.",
    how: "برای دیدن اینکه هر سفارش کجا رفته، «پیگیری سفارش» را باز کنید.",
  },
  "page.map": {
    id: "page.map",
    title: "این صفحه چه چیزی را نشان می‌دهد",
    what: "همهٔ مشتریان و مناطق روی یک نقشه. لایه‌ها را روشن و خاموش کنید تا پوشش، تراکم و مسیرها کنار هم دیده شوند.",
    how: "روی هر نقطه بزنید تا پروندهٔ آن مشتری باز شود. «پین‌های نقشه» جای مکان‌هایی است که هنوز تصمیمی درباره‌شان نگرفته‌اید.",
  },
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
