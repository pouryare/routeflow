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
import type { Metadata } from "next";

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
    help: "page.planner",
    overview:
      "مقصدهای یک روز را انتخاب کنید و ترتیب بهینهٔ بازدید را بگیرید. ترتیب پیشنهادی بازدیدها را می‌توانید جابه‌جا کنید و در پایان به ناوبری گوشی بفرستید.",
  },
  "/crm": {
    title: "مشتریان و سرنخ‌ها",
    titleEn: "Customers and leads",
    help: "page.crm",
    overview:
      "همهٔ کسب‌وکارهایی که با آن‌ها کار دارید، از سرنخ تازه تا مشتری دائمی. تماس بگیرید، نتیجه را با چند لمس ثبت کنید، و ببینید امروز با چه کسی کار دارید.",
  },
  "/leads": {
    title: "پین‌های نقشه",
    titleEn: "Map pins",
    help: "page.leads",
    overview:
      /* The inbox, not a half-finished CRM. Every pin here is one nobody has DECIDED
       * about yet: the moment you add it to a list it becomes a سرنخ and stops being a
       * dot on a map. So the verb on this page is «افزودن به فهرست», and the copy names
       * the two questions the two pages answer. */
      "مکان‌هایی که روی نقشه دیده‌اید و هنوز دربارهٔ آن‌ها تصمیم نگرفته‌اید. هر پینی که به یک فهرست اضافه شود، سرنخ می‌شود و از این صفحه می‌رود. «پین‌های نقشه» جای مکان‌هایی است که دیده‌اید، «مشتریان و سرنخ‌ها» جای کسب‌وکارهایی که می‌شناسید.",
  },

  "/sales/data-quality": {
    title: "کیفیت اطلاعات",
    titleEn: "Data quality",
    help: "page.data-quality",
    overview:
      "مشتریانی که مکان، تلفن یا منطقه‌شان ثبت نشده، با شمار هر گروه. روی هر ردیف بزنید تا پروندهٔ مشتری باز شود و همان‌جا کاملش کنید.",
  },

  // روز من
  "/sales/today": {
    title: "امروز",
    titleEn: "Today",
    help: "page.today",
    overview:
      "خلاصهٔ روز شما در یک صفحه: کارهای سررسیدشده، سفارش‌های منتظر، و هشدارهایی که همین امروز باید دیده شوند. از بالا به پایین کار کنید.",
  },
  "/sales/pocket": {
    title: "کارهای من",
    titleEn: "My tasks",
    help: "page.pocket",
    overview:
      "کارهای شما در سه دسته: امروز، این هفته و انجام‌شده. مدیرها نوار تیم را هم می‌بینند و با زدن روی هر نفر، کارهای او را باز می‌کنند.",
  },
  "/my-expenses": {
    title: "هزینه‌های من",
    titleEn: "My expenses",
    help: "page.my-expenses",
    overview:
      "هزینه‌ای که از جیب خودتان برای کار داده‌اید را اینجا ثبت کنید. مدیر تأیید می‌کند و مبلغ به شما برگردانده می‌شود. مدیرها درخواست‌های منتظر تأیید را هم همین‌جا می‌بینند.",
  },
  "/sales/schedule": {
    title: "برنامهٔ تحویل",
    titleEn: "Delivery schedule",
    help: "page.schedule",
    overview:
      "تقویم ماه، از بازدیدها و سفرهای تحویل با هم. در نمای «سفرها» سفارش‌های تأییدشده را به راننده‌ها تخصیص دهید و برگهٔ مسیرها را ببینید.",
  },

  // فروش و سفارش
  "/sales": {
    title: "خلاصهٔ فروش",
    titleEn: "Sales overview",
    help: "page.sales-home",
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
    help: "page.order-new",
    overview:
      "ثبت سفارش تازه: مشتری، اقلام و قیمت‌ها. پیش از تأیید، مانده و اعتبار مشتری کنار فرم نشان داده می‌شود.",
  },
  "/sales/forecast": {
    title: "پیش‌بینی",
    titleEn: "Forecast",
    help: "page.forecast",
    overview:
      "برآورد فروش دوره‌های آینده بر پایهٔ روند گذشته و ظرفیت. برای برنامه‌ریزی خرید و انبار، نه برای تعهد به عدد.",
  },
  "/sales/reasons": {
    title: "دلیل‌های ناکامی",
    titleEn: "Failure reasons",
    help: "page.reasons",
    overview:
      "چرا تحویل‌ها ناموفق شدند، سفارش‌ها لغو شدند، برگشتند یا دیر رسیدند، به تفکیک دلیل. برای پیدا کردن بزرگ‌ترین علت هر ماه، نه برای قضاوت دربارهٔ یک نفر.",
  },
  "/sales/lead-sources": {
    title: "منبع سرنخ‌ها",
    titleEn: "Lead sources",
    help: "page.lead-sources",
    overview:
      "هر منبع سرنخ (گوگل مپ، اینستاگرام، معرفی و بقیه) چند سرنخ آورده، چندتایش مشتری شده و این مشتری‌ها در سه ماه اول چقدر خرید کرده‌اند. برای اینکه بدانید وقت و پول را کجا بگذارید.",
  },
  "/sales/products": {
    title: "کالاها و قیمت‌ها",
    titleEn: "Products and prices",
    help: "page.products",
    overview:
      "فهرست کالاها با قیمت جاری و تاریخچهٔ تغییرات. قیمت را اینجا عوض کنید تا در سفارش‌های بعدی اعمال شود.",
  },
  "/sales/commission": {
    title: "پورسانت",
    titleEn: "Commission",
    help: "page.commission",
    overview:
      "پورسانت هر نماینده بر پایهٔ فروش تأییدشده و نرخ‌های تعریف‌شده. ردیف‌ها تا سفارش‌های پشتشان قابل باز کردن‌اند.",
  },

  // تحویل
  "/sales/batches": {
    title: "سری‌های ساخت",
    titleEn: "Production batches",
    help: "page.batches",
    overview:
      "سری‌های ساخت با وضعیت کیفی و موجودی هرکدام. برای ردیابی اینکه یک شکایت کیفی به کدام سری ساخت برمی‌گردد.",
  },
  "/sales/routing": {
    title: "مسیریابی",
    titleEn: "Routing",
    help: "page.routing",
    overview:
      "ساخت و تنظیم مسیرهای تحویل: قالب‌های مسیر، خودروها و ظرفیت روزانه. خروجی این صفحه، «سفرهای تحویل» است.",
  },

  "/sales/hours": {
    title: "ساعت کار رانندگان",
    titleEn: "Driver hours",
    help: "page.hours",
    overview:
      "برای هر راننده و هر روز: اولین شروع مسیر، آخرین پایان و مجموع ساعت‌های مسیر. راننده دکمهٔ تازه‌ای نمی‌زند؛ همه از شروع و پایان مسیرها محاسبه می‌شود.",
  },

  // مالی
  "/accounting/trial-balance": {
    title: "تراز آزمایشی",
    titleEn: "Trial balance",
    help: "page.trial-balance",
    overview:
      "جمع بدهکار و بستانکار هر حساب. دو ستون باید همیشه برابر باشند؛ همین برابری، تعریف دفتر سالم است.",
  },
  "/accounting/journal": {
    title: "دفتر روزنامه",
    titleEn: "Journal",
    help: "page.journal",
    overview:
      "همهٔ اسناد به ترتیب، با فیلتر بر اساس دوره و نوع. سند باطل‌شده حذف نمی‌شود: خط‌خورده می‌ماند و به سند معکوسش وصل است.",
  },
  "/accounting/balance-sheet": {
    title: "ترازنامه",
    titleEn: "Balance sheet",
    help: "page.balance-sheet",
    overview:
      "دارایی در برابر بدهی و سرمایه، در یک تاریخ مشخص — نه نتیجهٔ یک ماه. دورهٔ پیش از دفتر، ناقص از نظر بهای تمام‌شده علامت می‌خورد.",
  },
  "/accounting/income-statement": {
    title: "سود و زیان",
    titleEn: "Income statement",
    help: "page.income-statement",
    overview:
      "درآمد منهای بهای تمام‌شده و هزینه‌ها، برای یک دوره. اگر بهای تمام‌شدهٔ بخشی از فروش‌ها معلوم نباشد، صفحه صریحاً اعلام می‌کند که سود نمایش‌داده‌شده بیش از واقع است.",
  },
  "/accounting/money": {
    title: "ورودی و خروجی پول",
    titleEn: "Money in and out",
    overview:
      "پولی که در یک ماه به صندوق و بانک آمد و از آن‌ها رفت، با مانده اول و آخر ماه، مستقیماً از دفتر.",
  },
  "/accounting/payables": {
    title: "بدهی تأمین‌کنندگان",
    titleEn: "Accounts payable",
    help: "page.payables",
    overview:
      "آنچه به هر تأمین‌کننده بدهیم، مستقیماً از دفتر استخراج می‌شود و عدد جداگانه‌ای ذخیره نمی‌شود.",
  },
  "/accounting/expenses": {
    title: "هزینه‌ها",
    titleEn: "Expenses",
    help: "page.expenses",
    overview:
      "هزینه‌ها بر اساس حساب و بر اساس ثبت‌کننده. هر ردیف یک سند است، پس با «ابطال» اصلاح می‌شود، نه با ویرایش.",
  },
  "/accounting/shareholders": {
    title: "شرکا",
    titleEn: "Shareholders",
    help: "page.shareholders",
    overview:
      "شرکا، درصد سهم هرکدام با تاریخ شروع، و نوع شرکت. سود هر شریک از دفتر و همین درصدها محاسبه می‌شود.",
  },
  "/my-share": {
    title: "سهم من",
    titleEn: "My share",
    help: "page.myShare",
    overview: "سهم شما در شرکت، سرمایه و علی‌الحساب شما و سودی که به شما رسیده است؛ فقط حساب خودتان دیده می‌شود.",
  },
  "/accounting/suppliers": {
    title: "تأمین‌کنندگان",
    titleEn: "Suppliers",
    help: "page.suppliers",
    overview:
      "تأمین‌کنندگان و صورت‌حساب هرکدام از دفتر خوانده می‌شود؛ مانده همیشه با ترازنامه می‌خواند.",
  },
  "/sales/payments": {
    title: "دریافت‌ها",
    titleEn: "Payments received",
    help: "page.payments",
    overview:
      "ثبت و پیگیری دریافتی‌ها از مشتریان. مانده و سررسید هر مشتری کنار فرم می‌آید تا پیش از ثبت، تصویر کامل را ببینید.",
  },
  "/sales/cheques": {
    title: "چک‌ها",
    titleEn: "Cheques",
    help: "page.cheques",
    overview:
      "چرخهٔ عمر چک‌ها از دریافت تا وصول یا برگشت. چک‌های نزدیک سررسید و برگشتی‌ها بالای فهرست می‌آیند.",
  },
  "/report": {
    title: "گزارش پوشش",
    titleEn: "Coverage report",
    help: "page.report",
    overview:
      "گزارش کامل پوشش و مالی گروه، قابل چاپ و خروجی‌گیری. برای مرور دوره‌ای و بایگانی، نه برای کار روزانه.",
  },

  // تحلیل سرنخ‌ها -- a client page over the whole lead pool: where they are, how they score,
  // how they are distributed by status, and how many convert.

  // انبار
  "/sales/stock": {
    title: "انبار و خرید",
    titleEn: "Stock and purchasing",
    help: "page.stock",
    overview:
      "موجودی جاری، نقطهٔ سفارش، و خریدهای در راه. اقلامی که زیر حد هشدار رفته‌اند بالای فهرست علامت خورده‌اند.",
  },

  "/sales/stock/buy-list": {
    title: "فهرست خرید",
    titleEn: "Buy list",
    overview: "کالاهایی که به نقطهٔ سفارش رسیده‌اند، به تفکیک ارزان‌ترین تأمین‌کننده و با رعایت حداقل سفارش او.",
  },
  "/sales/stock/orders": {
    title: "سفارش‌های خرید",
    titleEn: "Purchase orders",
    overview: "سفارش‌هایی که به تأمین‌کننده داده‌اید و هنوز نرسیده‌اند، با تاریخ انتظار و آنچه رسیده است.",
  },
  "/sales/stock/on-date": {
    title: "موجودی در یک روز",
    titleEn: "Stock on a date",
    overview: "موجودی هر کالا در پایان یک روز گذشته، از حرکت‌های انبار.",
  },

  // مدیریت
  "/sales/tasks": {
    title: "کارتابل",
    titleEn: "Work queue",
    help: "page.tasks",
    overview:
      "کارهای تعریف‌شده و تکرارشونده، با مسئول و سررسید. برای تنظیم اینکه چه کاری، هرچند وقت یک‌بار، برای چه کسی ساخته شود.",
  },
  "/sales/reps": {
    title: "نمایندگان فروش",
    titleEn: "Sales representatives",
    help: "page.reps",
    overview:
      "کارنامهٔ نمایندگان: فروش، پوشش و کارهای باز هرکدام. برای دیدن اینکه چه کسی به کمک نیاز دارد.",
  },
  "/switch": {
    title: "ورود به‌عنوان یک حساب",
    titleEn: "Switch account",
    help: "page.switch",
    overview:
      "دیدن برنامه از چشم هر کاربر، در هر سازمانی. هر کاری که اینجا انجام دهید به نام همان شخص ثبت می‌شود.",
  },
  "/sales/academy": {
    title: "آموزش",
    titleEn: "Academy",
    help: "page.academy",
    overview:
      "کتابخانهٔ پاسخ به اعتراض‌های رایج و نکات فروش. کوتاه و قابل مرور پشت درٔ مشتری.",
  },
  "/sales/academy/manage": {
    title: "مدیریت درس‌ها",
    titleEn: "Manage lessons",
    overview:
      "درس‌های خود شرکت را بنویسید، عکس بگذارید و برای نقش‌ها اجباری کنید. مالک مربی‌ها را هم تعیین می‌کند.",
  },
  "/sales/door-sale": {
    title: "فروش در محل",
    titleEn: "Door sale",
    overview:
      "از کالای روی ماشین بفروشید یا نمونهٔ رایگان بدهید. فروش همان‌جا تحویل و پول هم ثبت می‌شود و از موجودی ماشین کم می‌شود.",
  },
  "/sales/catalogue": {
    title: "کالاها",
    titleEn: "Catalogue",
    overview:
      "کالاها با عکس، بسته‌بندی و قیمت، برای وقتی پشت در مشتری سؤال می‌کنند. بدون اینترنت هم آخرین نسخه دیده می‌شود.",
  },
  "/sales/complaints": {
    title: "شکایات",
    titleEn: "Complaints",
    help: "page.complaints",
    overview:
      "شکایت‌های ثبت‌شده و مسیر رسیدگی هرکدام. گراف رسیدگی نشان می‌دهد کار روی کدام گام ایستاده است.",
  },
  "/sales/admin/holidays": {
    title: "تعطیلات",
    titleEn: "Holidays",
    help: "page.holidays",
    overview:
      "ثبت تعطیلات قمری که هر سال جابه‌جا می‌شوند. تاریخ اعلامی را اینجا وارد کنید؛ تعطیلات شمسی خودکارند.",
  },
  "/sales/admin/users": {
    title: "کاربران",
    titleEn: "Users",
    help: "page.users",
    overview:
      "افزودن و ویرایش کاربران و نقش‌هایشان. تغییر نقش بلافاصله روی دسترسی‌ها اثر می‌گذارد.",
  },
  "/sales/admin/logins": {
    title: "گزارش ورودها",
    titleEn: "Login history",
    help: "page.logins",
    overview:
      "۱۰۰ تلاش اخیر برای ورود به حساب‌های سازمان: موفق یا ناموفق، از چه دستگاهی و چه نشانی. اگر ورودی عجیب دیدید، از آن کاربر بخواهید رمزش را عوض کند و از همهٔ دستگاه‌ها خارج شود.",
  },
  "/sales/admin/storage": {
    title: "فضای ذخیره‌سازی",
    titleEn: "Storage",
    help: "page.storage",
    overview:
      "جای عکس‌ها و رسیدهای شرکت: فضاهای S3 خودتان (مثل آروان)، اینکه هر نوع فایل کجا برود، کپی پشتیبان، سطل زباله و گزارش. تا یک فضا اضافه نشود، عکس و رسید ثبت نمی‌شود.",
  },
  "/sales/admin/data": {
    title: "داده‌ها",
    titleEn: "Data",
    overview:
      "همهٔ داده‌های شرکت را در یک فایل اکسل بگیرید، یا فایل ویرایش‌شده را بارگذاری کنید. پیش از ثبت می‌بینید چه چیزی تازه است، چه چیزی عوض می‌شود و کدام ردیف خطا دارد.",
  },
  "/sales/admin/companies": {
    title: "شرکت‌ها",
    titleEn: "Companies",
    overview:
      "ساخت شرکت تازه با نام، لوگو و مدیر اول، و نشانی اینترنتی هر شرکت (مثل app.example.ir). کاربران هر شرکت فقط از نشانی خودشان وارد می‌شوند و نام و لوگوی شرکت را در صفحهٔ ورود می‌بینند.",
  },
  "/sales/admin/status": {
    title: "وضعیت سامانه",
    titleEn: "System status",
    help: "page.status",
    overview:
      "سلامت خود برنامه در یک صفحه: آخرین پشتیبان، کارهای شبانه، همگام‌سازی گوشی‌ها، تازگی داده و ورودهای ناموفق. هر خط قرمز یعنی چیزی بی‌صدا از کار افتاده است.",
  },
  "/sales/admin/discounts": {
    title: "تخفیف‌ها",
    titleEn: "Discounts",
    help: "page.discounts",
    overview:
      "دو تنظیم شرکت برای تخفیف سفارش‌ها: تا چند درصد بدون تأیید رد شود و چه سهمی از تخفیف از کمیسیون افراد کم شود. زیر آن، آخرین تخفیف‌ها و وضعیتشان.",
  },
  "/sales/admin/rules": {
    title: "قانون‌ها",
    titleEn: "Rules",
    help: "page.rules",
    overview:
      "قانون‌های خودکار سازمان: چه چیزی را می‌بینند، چه می‌سازند و در ۱۴ روز اخیر چند بار اجرا شده‌اند. هر قانون را می‌توان خاموش کرد یا زمان انتظارش را عوض کرد.",
  },
  "/sales/admin/rating-tags": {
    title: "برچسب‌های ارزیابی",
    titleEn: "Rating tags",
    help: "page.rating-tags",
    overview:
      "برچسب‌های کوتاهی که راننده بعد از ستاره‌های بازدید یک مکان می‌زند، مثل «مشتری زیاد» یا «دسترسی سخت». امتیاز خوب برچسب‌های خوب را نشان می‌دهد و امتیاز کم برچسب‌های کم را.",
  },
  "/sales/admin/groups": {
    title: "گروه‌ها",
    titleEn: "Groups",
    help: "page.groups",
    overview:
      "تعریف گروه‌های فروش و قلمرو هرکدام. قلمرو تعیین می‌کند هر گروه کدام مشتریان را می‌بیند.",
  },


  // نقشه‌ای‌ها و تنظیمات
  "/facilities": {
    title: "مکان‌های ما",
    titleEn: "Our locations",
    help: "page.facilities",
    overview:
      "انبارها و پایگاه‌های خودمان روی نقشه و در فهرست. فاصلهٔ هر مشتری تا نزدیک‌ترین سایت از همین‌ها حساب می‌شود.",
  },
  "/gallery": {
    title: "گالری تصاویر",
    titleEn: "Image gallery",
    help: "page.gallery",
    overview:
      "همهٔ عکس‌های ثبت‌شده روی پرونده‌ها و بازدیدها، یک‌جا. برای مرور سریع آنچه از میدان برگشته است.",
  },
  "/settings/notifications": {
    title: "تنظیمات اعلان‌ها",
    titleEn: "Notification settings",
    help: "page.notification-settings",
    overview:
      "انتخاب اینکه چه رویدادی، از چه راهی، و در چه ساعت‌هایی به شما خبر بدهد. ساعات سکوت و اتصال تلگرام هم اینجاست.",
  },
  "/settings/security": {
    title: "امنیت و ورود",
    titleEn: "Account security",
    help: "page.security",
    overview:
      "ورودهای اخیر حساب شما و خروج از دستگاه‌های دیگر. اگر ورودی را نمی‌شناسید، از همهٔ دستگاه‌ها خارج شوید و رمز را عوض کنید.",
  },
  "/settings/sound": {
    title: "صدا",
    titleEn: "Sound",
    help: "page.sound-settings",
    overview: "صدای کوتاه برنامه هنگام ثبت، خطا و زدن دکمه‌ها. هر کس صدای خودش را روشن یا خاموش می‌کند و مالک شرکت نوع صدا را برای همه انتخاب می‌کند.",
  },
  "/settings/tutorials": {
    title: "آموزش برنامه",
    titleEn: "Tutorials",
    help: "page.tutorials",
    overview: "آموزش کوتاه هر کار، قدم به قدم روی همین برنامه. هر کدام را می‌توانید دوباره ببینید یا بدون راهنما تمرین کنید؛ تمرین روی اطلاعات نمونه است و چیزی ذخیره نمی‌شود.",
  },
  "/settings/updates": {
    title: "تازه‌های برنامه",
    titleEn: "What's new",
    help: "page.updates",
    overview: "تغییرهای برنامه که به کار شما مربوط است، تازه‌ترین بالا. هر بار که چیزی عوض شود، اینجا کوتاه نوشته می‌شود.",
  },
};

/** Copy for a `?view=` whose screen is not the host page's.
 *
 *  /sales/schedule's own title describes the month calendar; its runs view is a different
 *  screen, «سفرهای تحویل», so reading copy by route alone put «برنامهٔ تحویل» above the runs
 *  table. A view is not a route, so it lives here rather than in PAGE_META, whose test wants
 *  one entry per real route and no two routes sharing an English title. */
export const VIEW_META: Record<string, PageMeta> = {
  "/sales/schedule?view=runs": {
    title: "سفرهای تحویل",
    titleEn: "Delivery runs",
    help: "page.runs",
    overview:
      "این نمای از «برنامهٔ تحویل» است. سفرهای تحویل روز: هر سفر با راننده و توقف‌هایش.",
  },
};

/** The meta for a path, by longest-prefix match — so /sales/orders/12 shows the orders
 *  section's title rather than nothing. Falls back to a neutral pair rather than
 *  throwing: a missing overview should never be what takes a page down, and the test
 *  above is what actually keeps the table complete. */
export function pageMetaFor(pathname: string, view?: string): PageMeta {
  const key = Object.keys(PAGE_META)
    .filter((k) => pathname === k || pathname.startsWith(`${k}/`))
    .sort((a, b) => b.length - a.length)[0];
  // A view with its own copy wins over the host section's.
  const forView = view ? VIEW_META[`${pathname}?view=${view}`] : undefined;
  if (forView) return forView;
  // The fallback names the APP, not the missing page. An unmatched route is usually a stale
  // link, and showing the product name is the honest answer — the alternative is a Persian
  // title that claims to describe a screen nobody built.
  return key
    ? PAGE_META[key]
    : { title: "RouteFlow", titleEn: "RouteFlow", overview: "" };
}

/** The browser-tab title (and description) for a shell page. Only the page name goes here:
 *  the root layout's title template adds «· RouteFlow», so the tab reads «سفارش‌ها · RouteFlow». */
export function pageMetadata(route: string, view?: string): Metadata {
  const m = pageMetaFor(route, view);
  return { title: m.title, description: m.overview };
}
