/** The title and one-paragraph overview that open every shell page.
 *
 *  The brief asked that the first card of every page say what the page is for, in a
 *  couple of lines, rather than dropping the reader straight into a table. This is that
 *  copy, in one place: keyed by route so a page cannot quietly ship without it —
 *  tests/pageMeta.test.ts walks app/(shell) and fails on any route missing an entry, and
 *  on any entry whose route has gone.
 *
 *  Write for someone who has just arrived: what this screen holds, and what they are
 *  expected to do with it. Not a feature list.
 *
 *  `titleEn` exists because this app is used by people who read Persian and systems that do
 *  not — browser tabs, <title>, a screenshot in a bug report. It is NOT a word-for-word
 *  translation of the Persian title; it is the name a bilingual person would actually use for
 *  the page in English. That is why no two routes may share one: two pages with the same
 *  English name is how someone ends up on the wrong browser tab for ten minutes.
 *
 *  Required, not optional. Every route is forced to answer on the day it is added, because
 *  tests/pageMeta.test.ts walks app/(shell) and fails on any route missing an entry.
 *
 *  `help` is an optional id into `lib/help/` rather than a second paragraph: the copy already
 *  lives there, and a page should not be able to drift from it. */
export type PageMeta = { title: string; titleEn: string; overview: string; help?: string };


export const PAGE_META: Record<string, PageMeta> = {
  // میدان و نقشه
  "/map": {
    title: "نقشهٔ پوشش",
    titleEn: "Coverage map",
    help: "page.map",
    overview:
      "همهٔ مشتریان و مناطق روی یک نقشه. لایه‌ها را روشن و خاموش کنید تا پوشش، تراکم و مسیرها را کنار هم ببینید؛ روی هر نقطه بزنید تا پروندهٔ آن مشتری باز شود.",
  },
  "/planner": {
    title: "برنامه‌ریز مسیر",
    titleEn: "Route planner",
    overview:
      "مقصدهای یک روز را انتخاب کنید و ترتیب بهینهٔ بازدید را بگیرید. ترتیب پیشنهادی بازدیدها را می‌توانید جابه‌جا کنید و در پایان به ناوبری گوشی بفرستید.",
  },
  "/crm": {
    title: "مشتریان و سرنخ‌ها",
    titleEn: "Customers and leads",
    overview:
      "همهٔ کسب‌وکارهایی که با آن‌ها کار دارید، از سرنخ تازه تا مشتری دائمی. تماس بگیرید، نتیجه را با چند لمس ثبت کنید، و ببینید امروز با چه کسی کار دارید.",
  },
  "/leads": {
    title: "پین‌های نقشه",
    titleEn: "Map pins",
    overview:
      /* The inbox, not a half-finished CRM. Every pin here is one nobody has DECIDED
       * about yet: the moment you add it to a list it becomes a سرنخ and stops being a
       * dot on a map. So the verb on this page is «افزودن به فهرست», and the copy names
       * the two questions the two pages answer. */
      "مکان‌هایی که روی نقشه دیده‌اید و هنوز دربارهٔ آن‌ها تصمیم نگرفته‌اید. هر پینی که به یک فهرست اضافه شود، سرنخ می‌شود و از این صفحه می‌رود. «پین‌های نقشه» جای مکان‌هایی است که دیده‌اید، «مشتریان و سرنخ‌ها» جای کسب‌وکارهایی که می‌شناسید.",
  },

  // روز من
  "/sales/today": {
    title: "امروز",
    titleEn: "Today",
    overview:
      "خلاصهٔ روز شما در یک صفحه: کارهای سررسیدشده، سفارش‌های منتظر، و هشدارهایی که همین امروز باید دیده شوند. از بالا به پایین کار کنید.",
  },
  "/sales/pocket": {
    title: "کارهای من",
    titleEn: "My tasks",
    overview:
      "کارهای شما در سه دسته: امروز، این هفته و انجام‌شده. مدیرها نوار تیم را هم می‌بینند و با زدن روی هر نفر، کارهای او را باز می‌کنند.",
  },
  "/sales/schedule": {
    title: "برنامهٔ تحویل",
    titleEn: "Delivery schedule",
    overview:
      "تقویم ماه، از بازدیدها و سفرهای تحویل با هم. در نمای «سفرها» سفارش‌های تأییدشده را به راننده‌ها تخصیص دهید و برگهٔ مسیرها را ببینید.",
  },
  "/sales/journey": {
    title: "پیگیری سفارش",
    titleEn: "Order tracking",
    overview:
      "این نمای از «سفارش‌ها» است. چرخهٔ عمر سفارش از ثبت تا تسویه، به تفکیک مرحله. برای دیدن اینکه کار کجا گیر کرده و مسئولش کیست.",
  },

  // فروش و سفارش
  "/sales": {
    title: "خلاصهٔ فروش",
    titleEn: "Sales overview",
    overview:
      "نمای کلی فروش: ارقام سرصفحه، روند دوره، و میان‌برهایی به کارهایی که بیشتر از همه انجام می‌دهید.",
  },
  "/sales/dashboard": {
    title: "تحلیل فروش",
    titleEn: "Sales analysis",
    help: "page.dashboard",
    overview:
      "ارقام فروش در بازهٔ انتخابی، همراه با مقایسهٔ دوره و تفکیک منطقه و نماینده. برای فهمیدن «چرا» پشت عددها، نه فقط خودشان.",
  },
  "/sales/analysis": {
    title: "تحلیل",
    titleEn: "Analysis",
    overview:
      "تحلیل‌های عمیق‌تر فروش و پوشش: شاخص‌ها، دلایل تغییر، و مرکز اقدامی که می‌گوید کدام کار بیشترین اثر را دارد.",
  },
  "/sales/orders": {
    title: "سفارش‌ها",
    titleEn: "Orders",
    help: "page.orders",
    overview:
      "همهٔ سفارش‌ها با وضعیت و مدارکشان، در سه نما: فهرست کارت‌ها، تابلوی مرحله‌ها، و پیگیری یک سفارش از ثبت تا تسویه. روی هر کارت بزنید تا جزئیاتش باز شود.",
  },
  "/sales/orders/new": {
    title: "سفارش تازه",
    titleEn: "New order",
    overview:
      "ثبت سفارش تازه: مشتری، اقلام و قیمت‌ها. پیش از تأیید، مانده و اعتبار مشتری کنار فرم نشان داده می‌شود.",
  },
  "/sales/forecast": {
    title: "پیش‌بینی",
    titleEn: "Forecast",
    overview:
      "برآورد فروش دوره‌های آینده بر پایهٔ روند گذشته و ظرفیت. برای برنامه‌ریزی خرید و انبار، نه برای تعهد به عدد.",
  },
  "/sales/reasons": {
    title: "دلیل‌های ناکامی",
    titleEn: "Failure reasons",
    overview:
      "چرا تحویل‌ها ناموفق شدند، سفارش‌ها لغو شدند، برگشتند یا دیر رسیدند، به تفکیک دلیل. برای پیدا کردن بزرگ‌ترین علت هر ماه، نه برای قضاوت دربارهٔ یک نفر.",
  },
  "/sales/products": {
    title: "کالاها و قیمت‌ها",
    titleEn: "Products and prices",
    overview:
      "فهرست کالاها با قیمت جاری و تاریخچهٔ تغییرات. قیمت را اینجا عوض کنید تا در سفارش‌های بعدی اعمال شود.",
  },
  "/sales/commission": {
    title: "پورسانت",
    titleEn: "Commission",
    overview:
      "پورسانت هر نماینده بر پایهٔ فروش تأییدشده و نرخ‌های تعریف‌شده. ردیف‌ها تا سفارش‌های پشتشان قابل باز کردن‌اند.",
  },

  // تحویل
  "/sales/runs": {
    title: "سفرهای تحویل",
    titleEn: "Delivery runs",
    overview:
      "این نمای از «برنامهٔ تحویل» است. سفرهای تحویل روز: هر سفر با راننده و توقف‌هایش.",
  },
  "/sales/deliveries": {
    title: "تحویل‌ها",
    titleEn: "Deliveries",
    overview:
      "تلاش‌های تحویل هر سفارش روی صفحهٔ همان سفارش است؛ فهرست کارهای امروز در «مسیر امروز».",
  },
  "/sales/batches": {
    title: "سری‌های ساخت",
    titleEn: "Production batches",
    overview:
      "سری‌های ساخت با وضعیت کیفی و موجودی هرکدام. برای ردیابی اینکه یک شکایت کیفی به کدام سری ساخت برمی‌گردد.",
  },
  "/sales/routing": {
    title: "مسیریابی",
    titleEn: "Routing",
    overview:
      "ساخت و تنظیم مسیرهای تحویل: قالب‌های مسیر، خودروها و ظرفیت روزانه. خروجی این صفحه، «سفرهای تحویل» است.",
  },

  // مالی
  "/accounting/trial-balance": {
    title: "تراز آزمایشی",
    titleEn: "Trial balance",
    overview:
      "جمع بدهکار و بستانکار هر حساب. دو ستون باید همیشه برابر باشند؛ همین برابری، تعریف دفتر سالم است.",
  },
  "/accounting/journal": {
    title: "دفتر روزنامه",
    titleEn: "Journal",
    overview:
      "همهٔ اسناد به ترتیب، با فیلتر بر اساس دوره و نوع. سند باطل‌شده حذف نمی‌شود: خط‌خورده می‌ماند و به سند معکوسش وصل است.",
  },
  "/accounting/balance-sheet": {
    title: "ترازنامه",
    titleEn: "Balance sheet",
    overview:
      "دارایی در برابر بدهی و سرمایه، در یک تاریخ مشخص — نه نتیجهٔ یک ماه. دورهٔ پیش از دفتر، ناقص از نظر بهای تمام‌شده علامت می‌خورد.",
  },
  "/accounting/income-statement": {
    title: "سود و زیان",
    titleEn: "Income statement",
    overview:
      "درآمد منهای بهای تمام‌شده و هزینه‌ها، برای یک دوره. اگر بهای تمام‌شدهٔ بخشی از فروش‌ها معلوم نباشد، صفحه صریحاً اعلام می‌کند که سود نمایش‌داده‌شده بیش از واقع است.",
  },
  "/accounting/payables": {
    title: "بدهی تأمین‌کنندگان",
    titleEn: "Accounts payable",
    overview:
      "آنچه به هر تأمین‌کننده بدهیم، مستقیماً از دفتر استخراج می‌شود و عدد جداگانه‌ای ذخیره نمی‌شود.",
  },
  "/accounting/expenses": {
    title: "هزینه‌ها",
    titleEn: "Expenses",
    overview:
      "هزینه‌ها بر اساس حساب و بر اساس ثبت‌کننده. هر ردیف یک سند است، پس با «ابطال» اصلاح می‌شود، نه با ویرایش.",
  },
  "/accounting/suppliers": {
    title: "تأمین‌کنندگان",
    titleEn: "Suppliers",
    overview:
      "تأمین‌کنندگان و صورت‌حساب هرکدام از دفتر خوانده می‌شود؛ مانده همیشه با ترازنامه می‌خواند.",
  },
  "/sales/payments": {
    title: "دریافت‌ها",
    titleEn: "Payments received",
    overview:
      "ثبت و پیگیری دریافتی‌ها از مشتریان. مانده و سررسید هر مشتری کنار فرم می‌آید تا پیش از ثبت، تصویر کامل را ببینید.",
  },
  "/sales/cheques": {
    title: "چک‌ها",
    titleEn: "Cheques",
    overview:
      "چرخهٔ عمر چک‌ها از دریافت تا وصول یا برگشت. چک‌های نزدیک سررسید و برگشتی‌ها بالای فهرست می‌آیند.",
  },
  "/report": {
    title: "گزارش پوشش",
    titleEn: "Coverage report",
    overview:
      "گزارش کامل پوشش و مالی گروه، قابل چاپ و خروجی‌گیری. برای مرور دوره‌ای و بایگانی، نه برای کار روزانه.",
  },

  // تحلیل سرنخ‌ها -- a client page over the whole lead pool: where they are, how they score,
  // how they are distributed by status, and how many convert.

  // انبار
  "/sales/stock": {
    title: "انبار و خرید",
    titleEn: "Stock and purchasing",
    overview:
      "موجودی جاری، نقطهٔ سفارش، و خریدهای در راه. اقلامی که زیر حد هشدار رفته‌اند بالای فهرست علامت خورده‌اند.",
  },

  // مدیریت
  "/sales/board": {
    title: "تابلوی سفارش‌ها",
    titleEn: "Order board",
    overview:
      "این نمای از «سفارش‌ها» است. سفارش‌ها در ستون‌های مرحله، از ثبت تا تحویل. کارت‌ها را بین ستون‌ها بکشید تا مرحله‌شان عوض شود.",
  },
  "/sales/tasks": {
    title: "کارتابل",
    titleEn: "Work queue",
    overview:
      "کارهای تعریف‌شده و تکرارشونده، با مسئول و سررسید. برای تنظیم اینکه چه کاری، هرچند وقت یک‌بار، برای چه کسی ساخته شود.",
  },
  "/sales/reps": {
    title: "نمایندگان فروش",
    titleEn: "Sales representatives",
    overview:
      "کارنامهٔ نمایندگان: فروش، پوشش و کارهای باز هرکدام. برای دیدن اینکه چه کسی به کمک نیاز دارد.",
  },
  "/switch": {
    title: "ورود به‌عنوان یک حساب",
    titleEn: "Switch account",
    overview:
      "دیدن برنامه از چشم هر کاربر، در هر سازمانی. هر کاری که اینجا انجام دهید به نام همان شخص ثبت می‌شود.",
  },
  "/sales/academy": {
    title: "آموزش",
    titleEn: "Academy",
    overview:
      "کتابخانهٔ پاسخ به اعتراض‌های رایج و نکات فروش. کوتاه و قابل مرور پشت درٔ مشتری.",
  },
  "/sales/complaints": {
    title: "شکایات",
    titleEn: "Complaints",
    overview:
      "شکایت‌های ثبت‌شده و مسیر رسیدگی هرکدام. گراف رسیدگی نشان می‌دهد کار روی کدام گام ایستاده است.",
  },
  "/sales/admin/holidays": {
    title: "تعطیلات",
    titleEn: "Holidays",
    overview:
      "ثبت تعطیلات قمری که هر سال جابه‌جا می‌شوند. تاریخ اعلامی را اینجا وارد کنید؛ تعطیلات شمسی خودکارند.",
  },
  "/sales/admin/users": {
    title: "کاربران",
    titleEn: "Users",
    overview:
      "افزودن و ویرایش کاربران و نقش‌هایشان. تغییر نقش بلافاصله روی دسترسی‌ها اثر می‌گذارد.",
  },
  "/sales/admin/representatives": {
    title: "نمایندگان",
    titleEn: "Representatives",
    overview: "تعریف و راه‌اندازی نمایندگان حالا بخشی از صفحهٔ «نمایندگان فروش» است؛ این نشانی به همان‌جا می‌رود.",
  },
  "/sales/admin/logins": {
    title: "گزارش ورودها",
    titleEn: "Login history",
    overview:
      "۱۰۰ تلاش اخیر برای ورود به حساب‌های سازمان: موفق یا ناموفق، از چه دستگاهی و چه نشانی. اگر ورودی عجیب دیدید، از آن کاربر بخواهید رمزش را عوض کند و از همهٔ دستگاه‌ها خارج شود.",
  },
  "/sales/admin/status": {
    title: "وضعیت سامانه",
    titleEn: "System status",
    overview:
      "سلامت خود برنامه در یک صفحه: آخرین پشتیبان، کارهای شبانه، همگام‌سازی گوشی‌ها، تازگی داده و ورودهای ناموفق. هر خط قرمز یعنی چیزی بی‌صدا از کار افتاده است.",
  },
  "/sales/admin/groups": {
    title: "گروه‌ها",
    titleEn: "Groups",
    overview:
      "تعریف گروه‌های فروش و قلمرو هرکدام. قلمرو تعیین می‌کند هر گروه کدام مشتریان را می‌بیند.",
  },


  // نقشه‌ای‌ها و تنظیمات
  "/facilities": {
    title: "مکان‌های ما",
    titleEn: "Our locations",
    overview:
      "انبارها و پایگاه‌های خودمان روی نقشه و در فهرست. فاصلهٔ هر مشتری تا نزدیک‌ترین سایت از همین‌ها حساب می‌شود.",
  },
  "/gallery": {
    title: "گالری تصاویر",
    titleEn: "Image gallery",
    overview:
      "همهٔ عکس‌های ثبت‌شده روی پرونده‌ها و بازدیدها، یک‌جا. برای مرور سریع آنچه از میدان برگشته است.",
  },
  "/settings/notifications": {
    title: "تنظیمات اعلان‌ها",
    titleEn: "Notification settings",
    overview:
      "انتخاب اینکه چه رویدادی، از چه راهی، و در چه ساعت‌هایی به شما خبر بدهد. ساعات سکوت و اتصال تلگرام هم اینجاست.",
  },
  "/settings/security": {
    title: "امنیت و ورود",
    titleEn: "Account security",
    overview:
      "ورودهای اخیر حساب شما و خروج از دستگاه‌های دیگر. اگر ورودی را نمی‌شناسید، از همهٔ دستگاه‌ها خارج شوید و رمز را عوض کنید.",
  },
};

/** The meta for a path, by longest-prefix match — so /sales/orders/12 shows the orders
 *  section's title rather than nothing. Falls back to a neutral pair rather than
 *  throwing: a missing overview should never be what takes a page down, and the test
 *  above is what actually keeps the table complete. */
/** A `?view=` that used to be a page of its own, and which still owns that page's copy.
 *
 *  `/sales/runs` redirects to `/sales/schedule?view=runs`, so its title and overview describe
 *  THIS view and nothing else — «سفرهای تحویل» over the runs table is exactly right, and
 *  «برنامهٔ تحویل» is exactly wrong, because that is the month calendar.
 *
 *  Reusing the entry is why this needs no second PAGE_META key, which is deliberate:
 *  tests/pageMeta.test.ts requires one entry per REAL route and no two routes sharing an
 *  English title. A view is not a route, and inventing a key for one broke both rules at once.
 *  The copy already existed; it was simply never wired to the view that inherited it. */
const VIEW_META_ROUTE: Record<string, string> = {
  "/sales/schedule?view=runs": "/sales/runs",
};

export function pageMetaFor(pathname: string, view?: string): PageMeta {
  const key = Object.keys(PAGE_META)
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  // The inherited entry wins over the host section's, when there is one.
  const inherited = view ? VIEW_META_ROUTE[`${pathname}?view=${view}`] : undefined;
  if (inherited && PAGE_META[inherited]) return PAGE_META[inherited];
  // The fallback names the APP, not the missing page. An unmatched route is usually a stale
  // link, and showing the product name is the honest answer — the alternative is a Persian
  // title that claims to describe a screen nobody built.
  return key
    ? PAGE_META[key]
    : { title: "RouteFlow", titleEn: "RouteFlow", overview: "" };
}
