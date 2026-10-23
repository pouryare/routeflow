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
  /* F84: the five screens people use most and ask most about (the day, customers, payments,
   * routing, delivery runs). Each route declares its id in lib/pageMeta.ts. */
  "page.today": {
    id: "page.today",
    title: "این صفحه چه چیزی را نشان می‌دهد",
    what: "کارهای امروز شما به ترتیب فوریت: کارهای سررسیدشده، سفارش‌های منتظر تأیید، و هشدارهایی که همین امروز باید دیده شوند.",
    how: "از کارت بالا شروع کنید و پایین بیایید. هر کارتی که تمام شد از فهرست می‌رود؛ اگر صفحه خالی شد، کار امروز تمام است.",
  },
  "page.crm": {
    id: "page.crm",
    title: "این صفحه چه چیزی را نشان می‌دهد",
    what: "همهٔ مشتریان و سرنخ‌هایی که می‌توانید ببینید. نمای «امروز» کسانی است که امروز باید با آن‌ها تماس بگیرید یا سر بزنید.",
    how: "روی هر ردیف بزنید تا پرونده باز شود. بعد از هر تماس، نتیجه را با «ثبت نتیجه» ثبت کنید تا کار بعدی خودش ساخته شود.",
  },
  "page.payments": {
    id: "page.payments",
    title: "این صفحه چه چیزی را نشان می‌دهد",
    what: "پول‌هایی که از مشتریان گرفته شده: نقد، کارت و چک. هر دریافت از ماندهٔ همان مشتری کم می‌شود.",
    how: "پیش از ثبت، ماندهٔ مشتری را کنار فرم ببینید. دریافت اشتباه پاک نمی‌شود؛ باطل می‌شود تا ردش در دفتر بماند.",
  },
  "page.planner": {
    id: "page.planner",
    title: "این صفحه چه چیزی را نشان می‌دهد",
    what: "مقصدهای یک روز روی نقشه و ترتیب پیشنهادی بازدیدشان، با فاصله و زمان تقریبی.",
    how: "مقصدها را انتخاب کنید و «مسیر» بزنید. ترتیب را می‌توانید جابه‌جا کنید؛ در پایان مسیر را به ناوبری گوشی بفرستید.",
  },
  "page.runs": {
    id: "page.runs",
    title: "این صفحه چه چیزی را نشان می‌دهد",
    what: "سفرهای تحویل هر روز: کدام راننده، با کدام خودرو، چه توقف‌هایی دارد و هر توقف به کجا رسیده است.",
    how: "سفر آماده را باز کنید تا توقف‌ها را به ترتیب ببینید. توقف قرمز یعنی تحویل ناموفق؛ دلیلش روی همان توقف نوشته شده است.",
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
