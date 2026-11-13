import type { Tutorial } from "../types";
import { MANAGE_ROLES, OWNER_ROLES, type Role } from "@/lib/roles";

/** Tutorials for everyone who works in the app shell (bottom bar, «+ ثبت» button): owners, managers
 *  and phone sales. Every save in a tutorial is pretend (plan section 11) unless `real` says it is a
 *  setup job that should really be saved, such as adding a staff account.
 *
 *  Targets are `data-tour` ids: `nav:<href>` for a bar tab, `quick` for «+ ثبت», `open:<flow>` for
 *  the button that opens a tap flow, `<flow>:<step>:<answer>` for an answer inside it and
 *  `<flow>:<step>` for a whole step that needs typing or picking (moved on with «ادامه»). */

const OWNERS: readonly Role[] = OWNER_ROLES;
const MANAGERS: readonly Role[] = MANAGE_ROLES;
const LEADS: readonly Role[] = [...MANAGE_ROLES, "rep_manager"];
const SHELL: readonly Role[] = [...LEADS, "phone_sales"];
/** Shell roles that may record an order (canSell without the vans, who sell from /driver). */
const SELLERS: readonly Role[] = [...MANAGE_ROLES, "phone_sales"];
/** Shell roles that reach «دریافت‌ها» and «شکایات» (everyone but the rep manager). */
const MONEY: readonly Role[] = SELLERS;

/** The bottom-bar tour, one per bar layout (lib/mobileNav.ts PRIMARY_BY_ROLE). */
const barTour = (id: string, roles: readonly Role[], tabs: [string, string][]): Tutorial => ({
  id,
  title: "آشنایی با برنامه",
  roles,
  screen: "/sales/today",
  autoStart: true,
  keywords: ["شروع", "منو", "پایین", "راهنما"],
  steps: [
    { text: "سلام! خوش آمدید. در یک دقیقه نشانتان می‌دهیم هر چیزی کجاست.", say: "سَلام! خوش آمَدید. دَر یِک دَقیقه نِشانِتان می‌دَهیم هَر چیزی کُجاست." },
    ...tabs.map(([href, text]) => ({ text, target: `nav:${href}`, advance: "next" as const })),
    { text: "بقیهٔ صفحه‌ها در «بیشتر» هستند، از جمله «آموزش برنامه» که همهٔ آموزش‌ها را دارد.", target: "nav:more", advance: "next" },
    { text: "این دکمه از هر صفحه‌ای کار سریع ثبت می‌کند: یادآوری، یادداشت، سفارش، دریافت و شکایت.", target: "quick", advance: "next" },
  ],
});

const TODAY: [string, string] = ["/sales/today", "«امروز»: کارهای امروز، عددهای مهم و کارهایی که منتظر شماست."];
const CRM: [string, string] = ["/crm", "«مشتریان و سرنخ‌ها»: پیدا کردن هر مشتری، تماس و ثبت نتیجه."];
const ORDERS: [string, string] = ["/sales/orders", "«سفارش‌ها»: همهٔ سفارش‌ها و اینکه هر کدام در چه مرحله‌ای است."];
const MAP: [string, string] = ["/map", "«نقشهٔ پوشش»: مشتری‌ها روی نقشه، تا ببینید کجا کار شده و کجا نه."];

export const SHELL_TUTORIALS: Tutorial[] = [
  barTour("bar-manage", MANAGERS, [TODAY, CRM, ORDERS, MAP]),
  barTour("bar-rep-manager", ["rep_manager"], [TODAY, CRM, ["/sales/tasks", "«کارتابل»: کارهای تیم، چه کسی چه کاری دارد و کدام عقب افتاده."], MAP]),
  barTour("bar-phone", ["phone_sales"], [TODAY, CRM, ["/sales/pocket", "«کارهای من»: تماس‌ها و کارهای امروز شما به ترتیب."], ORDERS]),
  {
    id: "share-tour",
    title: "آشنایی با «سهم من»",
    roles: ["shareholder"],
    screen: "/my-share",
    autoStart: true,
    keywords: ["سهم", "سود", "شریک"],
    steps: [
      { text: "سلام! اینجا سهم شما از شرکت را می‌بینید." },
      { text: "بالای صفحه سهم شما و سود هر دوره است. پایین‌تر هر پرداخت یا برداشت با تاریخش آمده." },
      { text: "عددها را شرکت ثبت می‌کند. اگر چیزی درست نبود، به مدیر شرکت خبر دهید." },
    ],
  },

  /* ---- «+ ثبت» from any screen ---- */
  {
    id: "quick-reminder",
    title: "گذاشتن یادآوری",
    roles: SHELL,
    screen: "/sales/today",
    keywords: ["یادآوری", "یادم بنداز", "زنگ", "ساعت"],
    ghost: false,
    steps: [
      { text: "دکمهٔ «ثبت» را بزنید.", target: "quick" },
      { text: "«ثبت یادآوری» را بزنید.", target: "quick:reminder" },
      { text: "روز و ساعت را انتخاب کنید و «ادامه» را بزنید.", target: "reminder:when:ok" },
      { text: "یکی از متن‌های آماده را بزنید یا «متن دیگر…» را بزنید و خودتان بنویسید." },
      { text: "تمام! سر همان ساعت برنامه خبرتان می‌کند. یادآوری‌ها در «کارهای من» هم هستند." },
    ],
  },
  {
    id: "quick-note",
    title: "نوشتن یادداشت",
    roles: SHELL,
    screen: "/sales/today",
    keywords: ["یادداشت", "نوشتن", "نکته"],
    ghost: false,
    steps: [
      { text: "دکمهٔ «ثبت» را بزنید.", target: "quick" },
      { text: "«ثبت یادداشت» را بزنید.", target: "quick:note" },
      { text: "متن را بنویسید و «ثبت یادداشت» را بزنید. یادداشت فقط برای خودتان است." },
    ],
  },

  /* ---- Orders ---- */
  {
    id: "order-new",
    title: "ثبت سفارش تازه",
    roles: SELLERS,
    screen: "/sales/orders",
    firstSteps: true,
    ghost: false,
    keywords: ["سفارش", "فروش", "فاکتور", "خرید مشتری"],
    steps: [
      { text: "دکمهٔ «ثبت» را بزنید.", target: "quick" },
      { text: "«سفارش تازه» را بزنید.", target: "quick:order" },
      { text: "مشتری را پیدا کنید و رویش بزنید. با چند حرف از نامش هم پیدا می‌شود.", target: "order_quick:who" },
      { text: "اگر مثل دفعهٔ قبل است، «همان سفارش قبلی» را بزنید. اگر نه، «تغییر می‌دهم» و تعداد هر قلم را درست کنید." },
      { text: "روز تحویل را انتخاب کنید. «در اولین فرصت» یعنی روز خاصی قول نداده‌اید." },
      { text: "آخر کار «ثبت سفارش» را بزنید. سفارش به برنامهٔ تحویل می‌رود." },
    ],
  },
  {
    id: "orders-list",
    title: "پیدا کردن یک سفارش",
    roles: SELLERS,
    screen: "/sales/orders",
    keywords: ["سفارش", "وضعیت", "کجاست", "پیگیری"],
    steps: [
      { text: "اینجا همهٔ سفارش‌ها هستند. بالای صفحه می‌بینید هر مرحله چند سفارش دارد." },
      { text: "روی هر مرحله بزنید تا فقط سفارش‌های همان مرحله بیاید، مثلاً «در راه» یا «تحویل شد»." },
      { text: "روی هر سفارش بزنید تا اقلام، مبلغ و تاریخچه‌اش باز شود." },
    ],
  },

  /* ---- Money ---- */
  {
    id: "payment-new",
    title: "ثبت پولی که گرفتید",
    roles: MONEY,
    screen: "/sales/payments",
    firstSteps: true,
    ghost: false,
    keywords: ["دریافت", "پول", "واریز", "کارت به کارت", "نقد"],
    steps: [
      { text: "«ثبت دریافت جدید» را بزنید.", target: "open:payment" },
      { text: "مشتری را پیدا کنید و رویش بزنید.", target: "payment:who" },
      { text: "بگویید چطور پرداخت کرد: نقد، کارت به کارت یا چک." },
      { text: "مبلغ را بنویسید و «ثبت دریافت» را بزنید. پول به حساب مشتری می‌نشیند." },
    ],
  },
  {
    id: "cheque-new",
    title: "ثبت چک مشتری",
    roles: MANAGERS,
    screen: "/sales/cheques",
    ghost: false,
    keywords: ["چک", "سررسید", "صیادی", "بانک"],
    steps: [
      { text: "«ثبت چک جدید» را بزنید.", target: "open:cheque" },
      { text: "مشتری را انتخاب کنید.", target: "payment:who" },
      { text: "برنامه شمارهٔ چک، بانک و تاریخ سررسید را می‌پرسد. یکی‌یکی جواب دهید." },
      { text: "مبلغ را بنویسید و ثبت کنید. نزدیک سررسید برنامه یادتان می‌اندازد." },
    ],
  },
  {
    id: "complaint-new",
    title: "ثبت شکایت مشتری",
    roles: MONEY,
    screen: "/sales/complaints",
    ghost: false,
    keywords: ["شکایت", "مشکل", "خراب", "اعتراض"],
    steps: [
      { text: "«ثبت شکایت جدید» را بزنید.", target: "open:complaint" },
      { text: "مشتری را انتخاب کنید.", target: "complaint:who" },
      { text: "بگویید دربارهٔ کدام کالاست و مشکل چه بود." },
      { text: "چقدر جدی است را بزنید. شکایت جدی فوراً به مدیر خبر داده می‌شود." },
    ],
  },
  {
    id: "expense-new",
    title: "ثبت یک هزینه",
    roles: MANAGERS,
    screen: "/accounting/expenses",
    ghost: false,
    keywords: ["هزینه", "خرج", "بنزین", "اجاره", "قبض"],
    steps: [
      { text: "«ثبت هزینه» را بزنید.", target: "open:expense" },
      { text: "نوع هزینه را انتخاب کنید، مثلاً «سوخت» یا «اجاره».", target: "expense:category" },
      { text: "مبلغ را بنویسید و «ادامه» را بزنید.", target: "expense:amount", advance: "next" },
      { text: "به چه کسی دادید و چطور. اگر رسید دارید، از آن عکس بگیرید." },
    ],
  },

  /* ---- Customers ---- */
  {
    id: "crm-find",
    title: "پیدا کردن مشتری",
    roles: SHELL,
    screen: "/crm",
    firstSteps: true,
    demo: "crm",
    keywords: ["مشتری", "پیدا", "جستجو", "سرنخ"],
    steps: [
      { text: "نام، شماره یا محلهٔ مشتری را اینجا بنویسید.", target: "crm:search", advance: "next" },
      { text: "این دکمه‌ها فهرست را دسته می‌کنند: کارهای امروز، داغ‌ها، سرنخ‌های من و مشتری‌های من.", target: "crm:views", advance: "next" },
      { text: "هر کارت یک مشتری است. روی نامش بزنید تا پرونده‌اش باز شود.", target: "crm:list", advance: "next" },
    ],
  },
  {
    id: "crm-call",
    title: "تماس و ثبت نتیجه",
    roles: SHELL,
    screen: "/crm",
    firstSteps: true,
    demo: "crm",
    keywords: ["تماس", "زنگ", "نتیجه", "تلفن"],
    steps: [
      { text: "با این دکمه به مشتری زنگ می‌زنید.", target: "crm:call", advance: "next" },
      { text: "وقتی تماس تمام شد و به برنامه برگشتید، خودش می‌پرسد «تماس چطور بود؟»." },
      { text: "جواب‌ها را بزنید: صحبت کردیم، جواب نداد یا مشغول بود. برنامه کار بعدی را خودش می‌سازد، مثلاً «فردا ساعت ۱۰ دوباره زنگ بزن»." },
    ],
  },
  {
    id: "crm-add-lead",
    title: "افزودن مشتری تازه",
    roles: SHELL,
    screen: "/crm",
    ghost: false,
    keywords: ["سرنخ", "مشتری جدید", "افزودن", "اضافه"],
    steps: [
      { text: "«سرنخ تازه» را بزنید.", target: "open:add_lead" },
      { text: "بگویید از کجا پیدایش کردید. بعد نام و تلفن را بنویسید." },
      { text: "مکانش را روی نقشه بزنید و نوع کسب‌وکار را انتخاب کنید." },
      { text: "آخر بگویید اولین قدم چیست، مثلاً «تماس اول امروز». در کارهای شما می‌نشیند." },
    ],
  },
  {
    id: "task-result",
    title: "تمام کردن یک کار",
    roles: SHELL,
    screen: "/sales/today",
    firstSteps: true,
    ghost: false,
    keywords: ["کار", "نتیجه", "انجام شد", "تمام"],
    steps: [
      /* shortcut: no demo task on «امروز» yet, so this step cannot point at the button; add a demo row when Briefing gets a client slot. */
      { text: "کنار هر کار دکمهٔ «ثبت نتیجه» هست. آن را بزنید." },
      { text: "به چند سؤال کوتاه جواب دهید: چه شد و قدم بعدی کی است." },
      { text: "کار خط می‌خورد و کار بعدی خودش ساخته می‌شود." },
    ],
  },
  {
    id: "pocket-plan",
    title: "کارهای امروز من",
    roles: ["phone_sales"],
    screen: "/sales/pocket",
    keywords: ["کارهای من", "امروز", "برنامه", "فهرست"],
    steps: [
      { text: "اینجا کارهای امروز شما به ترتیب ساعت است. بالایی‌ها را اول انجام دهید." },
      { text: "با این دکمه یک یادآوری برای خودتان بگذارید.", target: "pocket:reminder", advance: "next" },
      { text: "کار انجام‌شده را با «ثبت نتیجه» ببندید. کار را به کنار بکشید تا برای بعد بماند." },
    ],
  },

  /* ---- Managers ---- */
  {
    id: "manage-board",
    title: "دیدن کارهای تیم",
    roles: LEADS,
    screen: "/sales/tasks",
    firstSteps: true,
    keywords: ["تیم", "کارتابل", "کارها", "عقب افتاده"],
    steps: [
      { text: "اینجا کارهای همهٔ تیم را می‌بینید، هر ستون یک وضعیت." },
      { text: "بالای صفحه می‌توانید نما را عوض کنید: بر اساس وضعیت، زمان یا گردش‌کار." },
      { text: "یک کار را بگیرید و به ستون دیگر بکشید، یا دکمهٔ «انتقال» کنارش را بزنید." },
    ],
  },
  {
    id: "manage-plan",
    title: "گذاشتن مشتری در برنامهٔ بازدید",
    roles: MANAGERS,
    screen: "/planner",
    ghost: false,
    keywords: ["برنامه", "بازدید", "مسیر", "فردا"],
    steps: [
      { text: "«افزودن به برنامه» را بزنید.", target: "open:visit_plan" },
      { text: "مشتری یا سرنخ را انتخاب کنید.", target: "visit_plan:who" },
      { text: "روز را انتخاب کنید. مشتری در مسیر همان روز قرار می‌گیرد." },
    ],
  },
  {
    id: "manage-reps",
    title: "دیدن کار نمایندگان",
    roles: LEADS,
    screen: "/sales/reps",
    firstSteps: true,
    keywords: ["نماینده", "فروشنده", "عملکرد"],
    steps: [
      { text: "هر ردیف یک نماینده است: چند تماس، چند بازدید و چقدر فروش داشته." },
      { text: "روی نام هر نفر بزنید تا جزئیات کارش را ببینید." },
    ],
  },
  {
    id: "manage-academy",
    title: "درس‌های لازم تیم",
    roles: LEADS,
    screen: "/sales/academy",
    firstSteps: true,
    keywords: ["آموزش", "درس", "آکادمی", "یادگیری"],
    steps: [
      { text: "«آموزش» درس‌های خواندنی است. بعضی درس‌ها برای هر نقش لازم است." },
      { text: "در جدول پایین می‌بینید هر نفر کدام درس لازم را خوانده و کدام مانده." },
    ],
  },

  {
    id: "manage-lessons",
    title: "نوشتن درس برای شرکت",
    roles: LEADS,
    screen: "/sales/academy/manage",
    keywords: ["درس", "آموزش", "مربی", "درس شرکت"],
    steps: [
      { text: "«درس تازه» را بزنید، عنوان و متن را بنویسید. «## » سرتیتر می‌سازد.", say: "«دَرسِ تازِه» را بِزَنید، عُنوان و مَتن را بِنویسید. «## » سَرتیتِر می‌سازَد." },
      { text: "برای یک عکس، «افزودن تصویر» را بزنید. عکس در جای خودش به متن اضافه می‌شود.", say: "بَرایِ یِک عَکس، «اَفزودَنِ تَصویر» را بِزَنید. عَکس دَر جایِ خودَش بِه مَتن اِضافه می‌شَوَد." },
      { text: "نقش‌ها را انتخاب کنید و «انتشار» را بزنید. تا منتشر نکنید، فقط خودتان می‌بینید.", say: "نَقش‌ها را اِنتِخاب کُنید و «اِنتِشار» را بِزَنید. تا مُنتَشِر نَکُنید، فَقَط خودتان می‌بینید." },
    ],
  },

  {
    id: "data-import",
    title: "گرفتن و بارگذاری داده‌ها با اکسل",
    roles: OWNERS,
    screen: "/sales/admin/data",
    keywords: ["اکسل", "داده", "خروجی", "بارگذاری", "ورود مشتری", "قیمت"],
    steps: [
      { text: "«دریافت فایل اکسل» همهٔ داده‌های شرکت را در یک فایل می‌دهد. برگه‌های مشتریان، کالاها و قیمت‌ها را می‌شود ویرایش کرد.", say: "«دِریافتِ فایلِ اِکسِل» هَمهٔ دادِه‌هایِ شِرکَت را دَر یِک فایل می‌دَهَد. بَرگِه‌هایِ مُشتَریان، کالاها و قیمَت‌ها را می‌شَوَد وِیرایِش کَرد.", target: "data-export", advance: "next" },
      { text: "فایل ویرایش‌شده را اینجا بارگذاری کنید. تا تأیید نکنید چیزی ذخیره نمی‌شود.", say: "فایلِ وِیرایِش‌شُده را اینجا بارگُذاری کُنید. تا تَأیید نَکُنید چیزی ذَخیره نِمی‌شَوَد.", target: "data-import", advance: "next" },
      { text: "برای هر ردیف می‌بینید تازه است، از چه به چه عوض می‌شود یا خطا دارد. «ثبت» را بزنید.", say: "بَرایِ هَر رَدیف می‌بینید تازِه اَست، اَز چِه بِه چِه عِوَض می‌شَوَد یا خَطا دارَد. «ثَبت» را بِزَنید." },
    ],
  },

  {
    id: "staff-leave",
    title: "ثبت مرخصی یک همکار",
    roles: OWNERS,
    screen: "/sales/admin/users",
    keywords: ["مرخصی", "همکار", "بیمار", "ماموریت", "واگذاری"],
    steps: [
      { text: "نام همکار را بزنید، مدت و دلیل را انتخاب کنید و «ثبت مرخصی» را بزنید. تا آن روز مشتری تازه‌ای به او پیشنهاد نمی‌شود.", say: "نامِ هَمکار را بِزَنید، مُدَّت و دَلیل را اِنتخاب کُنید و «ثَبتِ مُرَخَّصی» را بِزَنید. تا آن روز مُشتَریِ تازِه‌ای بِه او پیشنِهاد نِمی‌شَوَد.", target: "leave", advance: "next" },
      { text: "کارهایی که هنوز دست او مانده را از «واگذاری» پایین صفحه به همکار دیگری بسپارید.", say: "کارهایی که هَنوز دَستِ او مانده را اَز «واگُذاری» پایینِ صَفحه بِه هَمکارِ دیگَری بِسپارید." },
    ],
  },

  {
    id: "lend-customers",
    title: "قرض دادن مشتری‌های یک همکار",
    roles: OWNERS,
    screen: "/sales/admin/users",
    keywords: ["قرض", "واگذاری", "جانشین", "مشتری", "موقت"],
    steps: [
      { text: "همکاری که مشتری‌هایش را می‌دهید و همکاری که می‌گیرد را انتخاب کنید. اگر «تا کی؟» را روی چند روز بگذارید، مشتری‌ها فقط قرض داده می‌شوند.", say: "هَمکاری که مُشتَری‌هایَش را می‌دِهید و هَمکاری که می‌گیرَد را اِنتخاب کُنید. اگَر «تا کی؟» را رویِ چَند روز بِگذارید، مُشتَری‌ها فَقَط قَرض دادِه می‌شوند.", target: "handover", advance: "next" },
      { text: "در روز آخر مشتری‌ها خودشان به صاحب قبلی برمی‌گردند. زودتر هم با «برگرداندن» برمی‌گردند.", say: "دَر روزِ آخِر مُشتَری‌ها خودِشان بِه صاحِبِ قَبلی بَرمی‌گَردَند. زودتَر هَم بِا «بَرگَرداندَن» بَرمی‌گَردَند." },
    ],
  },

  {
    id: "assets",
    title: "ثبت دارایی‌های شرکت",
    roles: OWNERS,
    screen: "/sales/admin/users",
    keywords: ["دارایی", "موبایل", "ون", "تبلت", "سریال", "تحویل"],
    steps: [
      { text: "هر چیزی که شرکت دارد را اینجا ثبت کنید: نوع، نام و شماره سریال. «افزودن دارایی» را بزنید.", say: "هَر چیزی که شِرکَت دارَد را اینجا ثَبت کُنید: نوع، نام و شُمارِه سِریال. «اَفزودَن دارایی» را بِزَنید.", target: "assets", advance: "next" },
      { text: "روی هر ردیف بزنید تا بگویید دست چه کسی است، وضعیتش چیست یا از رده خارج شده است.", say: "رویِ هَر رَدیف بِزَنید تا بِگویید دَستِ چِه کَسی اَست، وَضعیَتَش چیست یا اَز رَدِه خارِج شُدِه اَست." },
    ],
  },

  /* ---- Stock ---- */
  {
    id: "stock-count",
    title: "شمردن موجودی انبار",
    roles: MANAGERS,
    screen: "/sales/stock",
    ghost: false,
    keywords: ["انبار", "موجودی", "شمارش", "انبارگردانی"],
    steps: [
      { text: "«شمارش انبار» را بزنید.", target: "open:stock_count" },
      { text: "برنامه برای هر کالا می‌پرسد عدد درست است یا نه. اگر فرق داشت، عدد شمرده‌شده را بنویسید." },
      { text: "دلیل فرق را بزنید، مثلاً «خراب شده». انبار درست می‌شود." },
    ],
  },
  {
    id: "stock-receive",
    title: "ثبت باری که رسید",
    roles: OWNERS,
    screen: "/sales/stock",
    ghost: false,
    keywords: ["خرید", "بار", "رسید", "ورود کالا", "انبار"],
    steps: [
      { text: "«دریافت کالا» را بزنید.", target: "open:receive" },
      { text: "کالا را انتخاب کنید.", target: "receive:product" },
      { text: "مقدار و قیمت خرید را بنویسید، بعد فروشنده و تاریخ انقضا را بگویید." },
      { text: "«ثبت دریافت» را بزنید. موجودی انبار بالا می‌رود." },
    ],
  },

  /* ---- Owner setup (real saves) ---- */
  {
    id: "owner-staff",
    title: "افزودن همکار",
    roles: OWNERS,
    screen: "/sales/admin/users",
    firstSteps: true,
    real: true,
    ghost: false,
    keywords: ["کاربر", "همکار", "راننده", "فروشنده", "حساب"],
    steps: [
      { text: "«کاربر جدید» را بزنید.", target: "open:user_add" },
      { text: "نقش او را بزنید، مثلاً «راننده» یا «فروش تلفنی»." },
      { text: "گروه و نامش را بنویسید و اگر خواستید شماره‌اش را." },
      { text: "تمام! نام کاربری و رمز موقت را به او بدهید. بار اول خودش رمز تازه می‌گذارد." },
    ],
  },
  {
    id: "owner-product",
    title: "افزودن کالا",
    roles: OWNERS,
    screen: "/sales/products",
    firstSteps: true,
    real: true,
    keywords: ["کالا", "محصول", "قیمت", "جنس"],
    steps: [
      { text: "در این بخش نام کالا، واحد (مثلاً کیلو) و وزن هر واحد را بنویسید.", target: "product:add", advance: "next" },
      { text: "«افزودن کالا» را بزنید.", target: "product:save" },
      { text: "حالا در بخش قیمت‌ها برای کالا قیمت بگذارید تا در سفارش‌ها بیاید." },
    ],
  },
  {
    id: "owner-print",
    title: "تنظیم برگه‌های چاپی",
    roles: OWNERS,
    screen: "/sales/admin/status",
    firstSteps: true,
    real: true,
    keywords: ["رسید", "فاکتور", "چاپ", "شرکت", "پایین برگه"],
    steps: [
      { text: "اینجا متن پایین رسید و فاکتور و پیشوند شمارهٔ سفارش را می‌نویسید.", target: "company:docs", advance: "next" },
      { text: "مثلاً شمارهٔ تماس شرکت یا «با تشکر از خرید شما». بعد ذخیره کنید." },
    ],
  },
  {
    id: "owner-2fa",
    title: "امن کردن ورود",
    roles: SHELL,
    screen: "/settings/security",
    firstSteps: true,
    real: true,
    keywords: ["امنیت", "رمز", "کد", "دومرحله", "authenticator"],
    steps: [
      { text: "ورود دومرحله‌ای یعنی علاوه بر رمز، یک کد از گوشی هم لازم است. اگر کسی رمزتان را بداند، باز هم نمی‌تواند وارد شود." },
      { text: "«فعال‌سازی» را بزنید.", target: "2fa:begin" },
      { text: "کد را در برنامهٔ Google Authenticator اضافه کنید و عدد شش‌رقمی را اینجا بنویسید." },
      { text: "کدهای پشتیبان را جایی امن نگه دارید. اگر گوشی گم شد، با آن‌ها وارد می‌شوید." },
    ],
  },
];
