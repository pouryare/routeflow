import { CONTACT_ROLE_LABEL, isDecider, LOST_REASON_LABEL, NOT_FIT_LABEL, NOT_FIT_REASONS, type LostReason } from "../vocab";
import { PICK, roleOptions, SKIP_STEP, timeOptions, TOMORROW_10 } from "./common";
import type { FlowConfig, FlowContext, FlowOption } from "./types";

const knownContacts = (ctx: FlowContext): FlowOption[] =>
  ctx.knownContacts.map((c) => ({
    id: `c${c.id}`, label: c.name ?? CONTACT_ROLE_LABEL[c.role], sub: `${CONTACT_ROLE_LABEL[c.role]} · آشنا`, tone: "rec",
    // A migrated contact has role OTHER (we never knew it); treat them as the right person.
    next: c.role === "OTHER" || isDecider(c.role) ? "what" : "gate", set: { contact_id: c.id, contact_role: c.role },
  }));

const WHY: LostReason[] = ["PRICE_HIGH", "HAS_SUPPLIER", "NO_NEED", "BUYS_FACTORY", "QUALITY", "PAYMENT_TERMS", "OTHER"];
const AGAIN = "تماس دوباره";
const INVALID_END = { outcome: "INVALID", invalid: true, due: { kind: "none" } } as const;

export const afterCallFlow: FlowConfig = {
  id: "after_call",
  start: (ctx) => (ctx.entry === "talked_now" ? "who" : "reach"),
  skipStep: "skip",
  budget: { common: 5, longest: 9 },
  steps: {
    reach: {
      id: "reach", kind: "choice", q: "تماس چطور بود؟",
      sub: (ctx) => (ctx.firstContact ? "تماس اول · {source}، هنوز تأیید نشده" : "{contact}"),
      options: [
        { id: "talked", label: "صحبت کردیم", next: (ctx) => (ctx.firstContact ? "verify" : "who"), set: { outcome: "TALKED" } },
        { id: "no_answer", label: "جواب نداد", next: "noans", set: { outcome: "NO_ANSWER" } },
        { id: "busy", label: "مشغول بود", next: "noans", set: { outcome: "BUSY" } },
        { id: "unavailable", label: "خاموش / در دسترس نیست", next: "noans", set: { outcome: "UNAVAILABLE" } },
        { id: "wrong", label: "شماره اشتباه / قطع است", tone: "bad", next: "wrong", set: { outcome: "WRONG_NUMBER" } },
      ],
    },
    noans: {
      id: "noans", kind: "choice", q: "کی دوباره زنگ بزنیم؟", timeStep: true,
      sub: (ctx) => (ctx.firstContact ? "تلاش {attempt} از {max} برای تأیید سرنخ" : "تلاش {attempt} بی‌پاسخ"),
      options: (ctx) => {
        const tired = ctx.attemptNo >= ctx.maxMisses;
        const times = tired
          ? timeOptions("تماس دوباره پس از وقفه", "call", [{ id: "park", label: "۳۰ روز دیگر", due: { kind: "in_days", days: 30, hour: 10 }, rec: true }])
          : timeOptions(AGAIN, "call", [
              { id: "t10", label: "فردا ۱۰:۰۰", due: TOMORROW_10, rec: true },
              { id: "h2", label: "۲ ساعت دیگر", due: { kind: "in_hours", hours: 2 } },
              { id: "t17", label: "فردا عصر", due: { kind: "tomorrow", hour: 17 } },
              PICK(),
            ]);
        const visits: FlowOption[] = ctx.firstContact || tired
          ? [
              { id: "visit", label: "خودم سر می‌زنم", sub: "به مسیر فردا", save: true, set: { next_title: "بازدید برای تأیید", next_kind: "visit", due: { kind: "tomorrow", hour: 11 } } },
              { id: "driver", label: "راننده سر بزند", sub: "در مسیر بعدی راننده", save: true, set: { next_title: "بازدید تأیید", next_kind: "verify_visit", next_assignee: "driver_pool", due: { kind: "tomorrow", hour: 9 } } },
            ]
          : [];
        return [...times, ...visits];
      },
    },
    wrong: {
      id: "wrong", kind: "choice", q: "شمارهٔ درست را دارید؟",
      options: [
        { id: "new", label: "بله، شمارهٔ جدید", next: "newnum" },
        { id: "later", label: "نه، بعداً پیدا می‌کنم", save: true, set: { next_title: "پیدا کردن شمارهٔ درست", next_kind: "outreach", due: TOMORROW_10 } },
        { id: "driver", label: "راننده سر بزند", sub: "شماره را حضوری بگیرد", save: true, set: { next_title: "بازدید تأیید", next_kind: "verify_visit", next_assignee: "driver_pool", due: { kind: "tomorrow", hour: 9 } } },
      ],
    },
    newnum: {
      id: "newnum", kind: "input", q: "شمارهٔ درست", input: { field: "new_phone", placeholder: "09__ ___ ____", ltr: true },
      options: [
        { id: "now", label: "ثبت و همین حالا تماس", tone: "rec", save: true, set: { next_title: "تماس با شمارهٔ جدید", next_kind: "call", due: { kind: "in_hours", hours: 0 }, redial: true } },
        { id: "later", label: "ثبت، فردا زنگ می‌زنم", save: true, set: { next_title: "تماس با شمارهٔ جدید", next_kind: "call", due: TOMORROW_10 } },
      ],
    },
    verify: {
      id: "verify", kind: "choice", q: "این همان «{name}» است؟", sub: "اطلاعات منبع اغلب قدیمی است؛ اول مطمئن شوید",
      options: [
        { id: "yes", label: "بله، همین است", tone: "rec", next: "who", set: { verification: "verified" } },
        { id: "renamed", label: "اسمش عوض شده", next: "rename" },
        { id: "moved", label: "جابه‌جا شده", next: "moved" },
        { id: "other", label: "کسب‌وکار دیگری است", next: "other" },
        { id: "closed", label: "تعطیل شده", tone: "bad", next: "closed" },
        { id: "notfit", label: "به کار ما نمی‌آید", next: "notfit" },
      ],
    },
    rename: {
      id: "rename", kind: "input", q: "نام تازه چیست؟", input: { field: "new_name", placeholder: "مثلاً: کبابی نایب ونک" },
      options: [{ id: "ok", label: "ادامه به سؤال بعد", next: "who", set: { verification: "renamed" } }],
    },
    moved: {
      id: "moved", kind: "choice", q: "آدرس تازه را دارید؟",
      options: [
        { id: "pin", label: "روی نقشه می‌زنم", sub: "نقشه باز می‌شود", tone: "rec", next: "movedpin", set: { verification: "moved" } },
        { id: "later", label: "بعداً، در بازدید", next: "who", set: { verification: "moved" } },
      ],
    },
    movedpin: { id: "movedpin", kind: "pin", q: "مکان تازه", options: [{ id: "ok", label: "ثبت مکان", next: "who" }] },
    other: {
      id: "other", kind: "choice", q: "این شماره مال کجاست؟ مشتری بالقوه است؟",
      options: [
        { id: "yes", label: "بله، سرنخ تازه بساز", sub: "افزودن سرنخ با همین شماره باز می‌شود", tone: "rec", save: true, set: { verification: "invalid_other_business", ...INVALID_END, spawn_lead: true } },
        { id: "no", label: "نه، ربطی ندارد", save: true, set: { verification: "wrong_number", outcome: "WRONG_NUMBER", next_title: "پیدا کردن شمارهٔ درست", next_kind: "outreach", due: TOMORROW_10 } },
      ],
    },
    closed: {
      id: "closed", kind: "choice", q: "کسب‌وکار تعطیل شده؟", sub: "از همهٔ فهرست‌ها بیرون می‌رود؛ تاریخچه می‌ماند",
      options: [{ id: "yes", label: "بله، تعطیل شده", tone: "bad", save: true, set: { verification: "invalid_closed", lost_reason: "CLOSED", ...INVALID_END } }],
    },
    notfit: {
      id: "notfit", kind: "choice", q: "چرا به کار ما نمی‌آید؟",
      options: NOT_FIT_REASONS.map((r) => ({ id: r, label: NOT_FIT_LABEL[r], save: true, set: { verification: "invalid_not_fit", not_fit: r, ...INVALID_END } })),
    },
    who: {
      id: "who", kind: "roles", q: "با چه کسی صحبت کردید؟", sub: "سمتش را بزنید؛ نام اختیاری است",
      input: { field: "contact_name", placeholder: "نام (اختیاری)…", optional: true },
      options: (ctx) => [...knownContacts(ctx), ...roleOptions("what", "gate")],
    },
    gate: {
      id: "gate", kind: "choice", q: "چه کسی خرید را انجام می‌دهد؟", sub: "{role} تصمیم‌گیرنده نیست",
      options: [
        { id: "through", label: "وصلم کرد", sub: "الان با خودش صحبت می‌کنم", tone: "rec", next: "who" },
        ...roleOptions("gatewhen", "gatewhen").filter((o) => o.group === "تصمیم‌گیرنده").map((o) => ({
          ...o, group: undefined, set: { decider_role: o.set!.contact_role, outcome: "GATEKEEPER" as const },
        })),
      ],
    },
    gatewhen: {
      id: "gatewhen", kind: "choice", q: "کی با {decider} تماس بگیریم؟", sub: "زمانی که گفتند در دسترس است", timeStep: true,
      options: timeOptions("تماس با {decider}", "call", [
        { id: "t10", label: "فردا صبح", due: TOMORROW_10, rec: true },
        { id: "today", label: "امروز عصر", due: { kind: "at_today", hour: 17 } },
        { id: "t14", label: "فردا بعد از ناهار", due: { kind: "tomorrow", hour: 15 } },
        PICK(),
      ]),
    },
    what: {
      id: "what", kind: "choice", q: "نتیجهٔ صحبت چه بود؟",
      options: [
        { id: "price", label: "قیمت خواست", sub: "داغ", next: "prods", set: { outcome: "ASKED_PRICE" } },
        { id: "sample", label: "نمونه خواست", sub: "داغ", next: "sampleprod", set: { outcome: "REQUESTED_SAMPLE" } },
        { id: "interested", label: "علاقه‌مند شد", sub: "گرم", next: "prods", set: { outcome: "INTERESTED" } },
        { id: "neg", label: "مذاکره / آمادهٔ سفارش", sub: "داغ", next: "neg", set: { outcome: "NEGOTIATING" } },
        { id: "obj", label: "ایراد گرفت", next: "obj" },
        { id: "later", label: "بعداً زنگ بزن", next: "later", set: { outcome: "CALL_BACK" } },
        { id: "no", label: "علاقه ندارد", sub: "سرد", tone: "bad", next: "why", set: { outcome: "NOT_INTERESTED" } },
      ],
    },
    prods: {
      id: "prods", kind: "multi", q: "کدام کالاها؟", sub: "چند تا را بزنید · اختیاری",
      choices: (ctx) => ctx.products.map((p) => ({ id: String(p.id), label: p.name })),
      options: [{ id: "ok", label: "ادامه به سؤال بعد", next: (_c, s) => (s.acc.outcome === "ASKED_PRICE" ? "sendnow" : "tinterest") }],
    },
    sendnow: {
      id: "sendnow", kind: "choice", q: "همین حالا قیمت بفرستم؟", sub: "از قیمت‌های امروز ساخته می‌شود",
      options: [
        { id: "wa", label: "ارسال در واتس‌اپ", sub: "پیشنهادی", tone: "rec", save: true, set: { share: "whatsapp", next_title: "پیگیری قیمت", next_kind: "quote_followup", due: { kind: "in_days", days: 3, hour: 10 } } },
        { id: "tg", label: "ارسال در تلگرام", save: true, set: { share: "telegram", next_title: "پیگیری قیمت", next_kind: "quote_followup", due: { kind: "in_days", days: 3, hour: 10 } } },
        { id: "later", label: "بعداً می‌فرستم", save: true, set: { next_title: "ارسال قیمت", next_kind: "outreach", due: { kind: "at_today", hour: 16 } } },
      ],
    },
    tinterest: {
      id: "tinterest", kind: "choice", q: "کی فهرست قیمت بفرستیم؟", timeStep: true,
      options: timeOptions("ارسال فهرست قیمت", "outreach", [
        { id: "t10", label: "فردا ۱۰:۰۰", due: TOMORROW_10, rec: true },
        { id: "today", label: "همین امروز", due: { kind: "at_today", hour: 16 } },
        { id: "d2", label: "۲ روز دیگر", due: { kind: "in_days", days: 2, hour: 10 } },
        PICK(),
      ]),
    },
    sampleprod: {
      id: "sampleprod", kind: "choice", q: "نمونهٔ کدام کالا؟",
      options: (ctx) => [
        ...ctx.products.slice(0, 7).map((p, i) => ({ id: `p${p.id}`, label: p.name, tone: i === 0 ? ("rec" as const) : undefined, next: "sampleqty", set: { product_id: p.id } })),
        { id: "other", label: "کالای دیگر", next: "sampleqty" },
      ],
    },
    sampleqty: {
      id: "sampleqty", kind: "choice", q: "چه مقدار؟",
      options: ["۱ بسته", "۲ بسته", "۵ عدد", "۱ کارتن"].map((q, i) => ({ id: `q${i}`, label: q, tone: i === 0 ? ("rec" as const) : undefined, next: "samplewhen", set: { sample_qty: q } })),
    },
    samplewhen: {
      id: "samplewhen", kind: "choice", q: "کی نمونه را تحویل بدهیم؟", timeStep: true,
      options: timeOptions("تحویل نمونه", "sample_delivery", [
        { id: "t10", label: "فردا", due: TOMORROW_10, rec: true },
        { id: "today", label: "امروز", due: { kind: "at_today", hour: 17 } },
        { id: "d2", label: "پس‌فردا", due: { kind: "in_days", days: 2, hour: 10 } },
        PICK(),
      ]),
    },
    neg: {
      id: "neg", kind: "choice", q: "قدم بعدی؟",
      options: [
        { id: "order", label: "ثبت سفارش همین حالا", sub: "صفحهٔ سفارش باز می‌شود", tone: "rec", save: true, set: { next_title: "ثبت سفارش", next_kind: "order", due: { kind: "in_hours", hours: 0 }, open_order: true } },
        { id: "follow", label: "پیگیری ۲ روز دیگر", save: true, set: { next_title: "پیگیری مذاکره", next_kind: "call", due: { kind: "in_days", days: 2, hour: 10 } } },
      ],
    },
    obj: {
      id: "obj", kind: "choice", q: "ایراد دربارهٔ چه بود؟",
      options: [
        { id: "price", label: "قیمت", next: "objwhen", set: { outcome: "PRICE_OBJECTION" } },
        { id: "pay", label: "شرایط پرداخت", next: "objwhen", set: { outcome: "PAYMENT_TERMS" } },
        { id: "quality", label: "کیفیت", next: "objwhen", set: { outcome: "QUALITY_DOUBT" } },
        { id: "supplier", label: "تأمین‌کننده دارد", next: "objwhen", set: { outcome: "ALREADY_SUPPLIED" } },
      ],
    },
    objwhen: {
      id: "objwhen", kind: "choice", q: "کی دوباره تماس بگیریم؟", timeStep: true,
      options: timeOptions(AGAIN, "call", [
        { id: "d3", label: "۳ روز دیگر", due: { kind: "in_days", days: 3, hour: 10 }, rec: true },
        { id: "t10", label: "فردا", due: TOMORROW_10 },
        { id: "d7", label: "هفتهٔ بعد", due: { kind: "in_days", days: 7, hour: 10 } },
        PICK(),
      ]),
    },
    later: {
      id: "later", kind: "choice", q: "کی زنگ بزنیم؟", sub: "زمانی که خودش گفت", timeStep: true,
      options: timeOptions(AGAIN, "call", [
        { id: "t10", label: "فردا ۱۰:۰۰", due: TOMORROW_10, rec: true },
        { id: "today", label: "امروز عصر", due: { kind: "at_today", hour: 17 } },
        { id: "d7", label: "هفتهٔ بعد", due: { kind: "in_days", days: 7, hour: 10 } },
        PICK("روز و ساعت…"),
      ]),
    },
    why: {
      id: "why", kind: "choice", q: "چرا علاقه ندارد؟",
      options: [
        ...WHY.map((r) => ({ id: r, label: LOST_REASON_LABEL[r], next: "wb", set: { lost_reason: r } })),
        { id: "CLOSED", label: LOST_REASON_LABEL.CLOSED, tone: "bad" as const, next: "closed" },
      ],
    },
    wb: {
      id: "wb", kind: "choice", q: "کی دوباره امتحان کنیم؟", sub: "سرنخ حذف نمی‌شود؛ سر وقتش برمی‌گردد",
      options: [
        ...timeOptions("تماس دوباره (بازگشت)", "call", [
          { id: "m3", label: "۳ ماه دیگر", due: { kind: "in_months", months: 3, hour: 10 }, rec: true },
          { id: "d30", label: "۳۰ روز دیگر", due: { kind: "in_days", days: 30, hour: 10 } },
          { id: "m6", label: "۶ ماه دیگر", due: { kind: "in_months", months: 6, hour: 10 } },
          { id: "m12", label: "۱۲ ماه دیگر", due: { kind: "in_months", months: 12, hour: 10 } },
        ]),
        { id: "reassign", label: "بده به فروشندهٔ دیگر", save: true, set: { next_title: "واگذاری «{name}» به فروشندهٔ دیگر", next_kind: "outreach", next_assignee: "group_manager", due: TOMORROW_10 } },
        { id: "contact", label: "با فرد دیگری صحبت کنم", save: true, set: { next_title: "پیدا کردن فرد دیگر", next_kind: "outreach", due: { kind: "in_days", days: 7, hour: 10 } } },
      ],
    },
    skip: SKIP_STEP,
  },
};
