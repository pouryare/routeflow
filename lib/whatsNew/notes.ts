import type { Role } from "@/lib/roles";

/** F112: what changed in the app, for the people who use it. Newest first. Each release that
 *  changes something staff will notice adds one entry here, in plain Persian, as part of its
 *  pull request. `roles` narrows a line to the people it concerns; a line without it is for
 *  everyone. The `version` is the release date, and is the key remembered per user. */
interface WhatsNewItem {
  text: string;
  roles?: Role[];
  /** Idea I10: a 1 to 3 step change tour (a tutorial id) the card offers beside the line. */
  tour?: string;
}

export interface WhatsNewEntry {
  version: string;
  items: WhatsNewItem[];
}

const MANAGERS: Role[] = ["platform_owner", "owner", "group_manager"];
const SELLERS: Role[] = ["phone_sales"];

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "2026-11-09",
    items: [
      { text: "زنگ اعلان‌ها، فهرست سفارش‌ها، برنامهٔ مسیرها و نقشهٔ پوشش حالا خودشان به‌روز می‌شوند: کاری که همکارتان انجام می‌دهد در چند لحظه روی صفحهٔ شما هم دیده می‌شود." },
      { text: "اگر کس دیگری هم همان سفارش را باز کرده باشد، زیر عنوان سفارش نوشته می‌شود؛ پیش از تغییر، با او هماهنگ کنید.", roles: [...SELLERS, ...MANAGERS] },
    ],
  },
  {
    version: "2026-11-06",
    items: [
      { text: "آموزش‌های کوتاه آمده است: از «بیشتر» ← «آموزش برنامه» یا با نوشتن «چطور…» در جستجو، هر کاری را قدم به قدم ببینید و تمرین کنید." },
      { text: "مدیر می‌تواند یک آموزش را برای همکارش بفرستد و ببیند دیده و انجام شده یا نه.", roles: MANAGERS, tour: "manage-reps" },
    ],
  },
  {
    version: "2026-10-23",
    items: [
      { text: "در صفحهٔ امروز، فهرست «موعد سفارش امروز» مشتری‌هایی را نشان می‌دهد که طبق عادت خریدشان امروز وقت سفارششان است.", roles: SELLERS },
      { text: "کارت «پورسانت این ماه تا امروز» در صفحهٔ امروز آمده است، با همان عددی که صفحهٔ پورسانت نشان می‌دهد.", roles: SELLERS },
      { text: "در سفارش سریع، گزینهٔ «سبد همیشگی» کالاهایی را که مشتری معمولاً می‌خرد با تعداد معمولشان پر می‌کند.", roles: [...SELLERS, ...MANAGERS] },
      { text: "اگر برای همان مشتری در ۲۴ ساعت گذشته سفارش بازی با همان کالاها باشد، پیش از ثبت دوباره هشدار می‌گیرید.", roles: [...SELLERS, ...MANAGERS] },
      { text: "کاری را که الان وقتش نیست می‌توانید تا یک ساعت دیگر یا فردا ساعت ۹ عقب بیندازید.", roles: [...SELLERS, ...MANAGERS] },
      { text: "جستجوی بالای صفحه حالا یادداشت‌های پروندهٔ مشتری را هم می‌گردد." },
      { text: "کارت «این هفته در برابر هفتهٔ قبل» در صفحهٔ امروز آمده است.", roles: MANAGERS },
      { text: "مالک هر صبح از ساعت ۷ یک خلاصهٔ کوتاه از کارهای روز در اعلان یا تلگرام می‌گیرد؛ از تنظیمات اعلان‌ها خاموش می‌شود.", roles: ["owner"] },
      { text: "برگهٔ قیمت روز را از صفحهٔ کالاها چاپ کنید یا PDF بگیرید و برای مشتری بفرستید." },
      { text: "همهٔ برگه‌های تحویل یک سفر را از تختهٔ روز یک‌جا چاپ کنید.", roles: MANAGERS },
      { text: "صفحه‌های تازه برای مدیران: «کیفیت اطلاعات» (مشتری‌های بی‌نشانی یا بی‌شماره) و «منبع سرنخ‌ها».", roles: MANAGERS },
    ],
  },
];
