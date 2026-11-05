import type { Tutorial } from "../types";
import type { Role } from "@/lib/roles";

/** The driver's day on /driver (delivery_driver, and field_rep where they run a van). Every money
 *  step runs on the demo run with pretend saves, so practising never records a real payment. */
const VAN: readonly Role[] = ["delivery_driver", "field_rep"];

export const VAN_TUTORIALS: Tutorial[] = [
  {
    id: "van-bar",
    title: "آشنایی با صفحهٔ امروز",
    roles: VAN,
    screen: "/driver",
    autoStart: true,
    demo: "driver-day",
    keywords: ["شروع", "صفحه", "راهنما"],
    steps: [
      { text: "سلام! این صفحهٔ کار امروز شماست. این سه خانه می‌گویند چند مشتری مانده، امروز چقدر گرفته‌اید و چقدر مانده.", say: "سَلام! این صَفحه‌یِ کارِ اِمروزِ شُماست. این سه خانه می‌گویَند چَند مُشتَری مانده، اِمروز چِقَدر گِرِفته‌اید و چِقَدر مانده.", target: "run-tiles", advance: "next" },
      { text: "هر ردیف یک مشتری است. روی اولین مشتری بزنید تا سفارشش باز شود.", say: "هَر رَدیف یِک مُشتَری اَست. رویِ اَوَّلین مُشتَری بِزَنید تا سِفارِشَش باز شَوَد.", target: "stop-open" },
      { text: "اینجا اقلام سفارش و جمع مبلغ را می‌بینید. وقتی تحویل دادید، از دکمهٔ «ثبت تحویل» استفاده کنید.", target: "stop-deliver", advance: "next" },
      { text: "هر وقت خواستید، همهٔ آموزش‌ها در «آموزش برنامه» هست.", target: "link:/settings/tutorials", advance: "next" },
    ],
  },
  {
    id: "van-deliver",
    title: "ثبت تحویل و گرفتن کل مبلغ",
    roles: VAN,
    screen: "/driver",
    firstSteps: true,
    demo: "driver-day",
    keywords: ["تحویل", "پول", "نقد", "دریافت", "مبلغ"],
    steps: [
      { text: "روی مشتری بزنید.", target: "stop-open" },
      { text: "«ثبت تحویل این مشتری» را بزنید.", target: "stop-deliver" },
      { text: "اگر همهٔ اقلام را تحویل دادید، «بله، همه» را بزنید.", target: "delivery:all:yes" },
      { text: "کل مبلغ را گرفتید؟ دکمه را تا آخر بکشید.", say: "کُلِّ مَبلَغ را گِرِفتید؟ دُکمه را تا آخَر بِکِشید.", target: "delivery:cash:full" },
      { text: "تمام! تحویل ثبت شد. اگر اینترنت قطع باشد، برنامه نگهش می‌دارد و بعداً خودش می‌فرستد." },
    ],
  },
  {
    id: "van-short",
    title: "وقتی بخشی از بار تحویل نشد",
    roles: VAN,
    screen: "/driver",
    demo: "driver-day",
    keywords: ["کم", "کسری", "برگشت", "تحویل ناقص"],
    steps: [
      { text: "روی مشتری بزنید.", target: "stop-open" },
      { text: "«ثبت تحویل این مشتری» را بزنید.", target: "stop-deliver" },
      { text: "اگر چیزی کم شد یا مشتری بخشی را پس داد، «نه، کم شد» را بزنید.", target: "delivery:all:no" },
      { text: "تعداد هر قلم را با دکمه‌های بعلاوه و منها درست کنید. بعد «ادامه» را بزنید.", target: "delivery:short:ok" },
      { text: "دلیل را انتخاب کنید تا مدیر بداند چه شد. بقیه مثل یک تحویل معمولی است." },
    ],
  },
  {
    id: "van-other-amount",
    title: "گرفتن بخشی از پول",
    roles: VAN,
    screen: "/driver",
    demo: "driver-day",
    keywords: ["مبلغ", "علی الحساب", "نصف", "پول"],
    steps: [
      { text: "روی مشتری بزنید.", target: "stop-open" },
      { text: "«ثبت تحویل این مشتری» را بزنید.", target: "stop-deliver" },
      { text: "«بله، همه» را بزنید.", target: "delivery:all:yes" },
      { text: "مشتری فقط بخشی از پول را داد؟ «مبلغ دیگر…» را بزنید.", target: "delivery:cash:other" },
      { text: "مبلغی که گرفتید را بنویسید و دکمه را بکشید. بقیه به حساب مشتری می‌ماند." },
    ],
  },
  {
    id: "van-no-cash",
    title: "تحویل بدون گرفتن پول",
    roles: VAN,
    screen: "/driver",
    demo: "driver-day",
    keywords: ["نسیه", "حساب", "پول نگرفتم"],
    steps: [
      { text: "روی مشتری بزنید.", target: "stop-open" },
      { text: "«ثبت تحویل این مشتری» را بزنید.", target: "stop-deliver" },
      { text: "«بله، همه» را بزنید.", target: "delivery:all:yes" },
      { text: "پولی نگرفتید؟ «چیزی نگرفتم» را تا آخر بکشید. مبلغ به حساب مشتری می‌ماند.", target: "delivery:cash:none" },
    ],
  },
  {
    id: "van-later",
    title: "گذاشتن یک مشتری برای بعد",
    roles: VAN,
    screen: "/driver",
    firstSteps: true,
    demo: "driver-day",
    keywords: ["بعدا", "تعویق", "بسته بود", "نبود"],
    steps: [
      { text: "مغازه بسته بود؟ اول روی مشتری بزنید.", target: "stop-open" },
      { text: "«بعداً این توقف» را بزنید. این مشتری به آخر صف می‌رود.", target: "stop-later" },
      { text: "راه سریع‌تر: ردیف مشتری را به کنار بکشید تا همین دکمه‌ها بیرون بیایند." },
    ],
  },
  {
    id: "van-receipt",
    title: "نشان دادن و چاپ رسید",
    roles: VAN,
    screen: "/driver",
    firstSteps: true,
    demo: "driver-day",
    keywords: ["رسید", "فاکتور", "چاپ", "پرینت"],
    steps: [
      { text: "روی مشتری بزنید.", target: "stop-open" },
      { text: "«نمایش رسید» را بزنید.", target: "stop-receipt" },
      { text: "رسید پایین صفحه باز می‌شود. می‌توانید چاپش کنید یا برای مشتری بفرستید." },
    ],
  },
  {
    id: "van-offline",
    title: "کار بدون اینترنت",
    roles: VAN,
    screen: "/driver",
    keywords: ["اینترنت", "آفلاین", "قطع", "بدون نت"],
    steps: [
      { text: "اینترنت قطع شد؟ نگران نباشید. تحویل‌ها و پول‌ها روی گوشی ذخیره می‌شوند." },
      { text: "تا وقتی چیزی ارسال نشده، یک خط زرد بالای صفحه می‌گوید چند مورد مانده." },
      { text: "به‌محض وصل شدن، برنامه خودش همه را می‌فرستد. لازم نیست کاری بکنید." },
    ],
  },
];
