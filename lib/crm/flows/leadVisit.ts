import { PICK, SKIP_STEP, timeOptions, TOMORROW_10 } from "./common";
import type { FlowConfig, FlowContext, FlowOption } from "./types";

/** The one Persian word for "the driver was there and someone was there to talk to". */
const AGAIN = "یادآوری";
/** Shown on the success branch when the driver talked to the owner and the owner is
 *  interested but wants a phone call later. Handoff to sales, do not close. */
const PARTIAL = "علاقه‌مند ولی نیاز به تماس";

const SUCCESS = { outcome: "VISITED" } as const;
const FAILED = { outcome: "ACCESS_FAILED" } as const;

export const leadVisitFlow: FlowConfig = {
  id: "lead_visit",
  start: () => "navigate",
  skipStep: "skip",
  budget: { common: 6, longest: 11 },
  steps: {
    /** Step 0 -- the driver is standing in front of the place. One button: open the nav app.
     *  Tapping it does nothing to the flow; the host opens the URL. The flow only advances
     *  when the driver comes back and says what happened. */
    navigate: {
      id: "navigate", kind: "choice", q: "برو و ببین",
      sub: "برای رفتن به این آدرس مسیریابی را باز کن",
      options: [{ id: "go", label: "شروع مسیریابی", tone: "rec", next: "what_happened" }],
    },

    /** Step 1 -- the binary that decides the rest of the flow. */
    what_happened: {
      id: "what_happened", kind: "choice", q: "چه شد؟",
      sub: "نتیجهٔ حضور شما را بگو",
      options: [
        { id: "ok", label: "موفق", tone: "rec", next: "detail_status", set: SUCCESS },
        { id: "no", label: "ناموفق", tone: "bad", next: "why_failed", set: FAILED },
      ],
    },

    // ---- success branch -------------------------------------------------

    detail_status: {
      id: "detail_status", kind: "choice", q: "وضعیت دقیق",
      sub: "موفق بودید، حالا چی؟",
      options: [
        { id: "buy", label: "آماده خرید", next: "convert", set: { outcome: "READY_TO_BUY" } },
        { id: "partial", label: PARTIAL, next: "convert", set: { outcome: "INTERESTED", handoff_sales: true } },
        { id: "closed", label: "بسته بود", next: "convert", set: { outcome: "VISIT_CLOSED" } },
        { id: "noowner", label: "صاحب‌ش نبود", next: "convert", set: { outcome: "VISIT_NO_OWNER" } },
      ],
    },

    convert: {
      id: "convert", kind: "choice", q: "تبدیل به مشتری؟",
      sub: "آیا این سرنخ به مشتری تبدیل شد؟",
      options: [
        { id: "yes", label: "بله", tone: "rec", next: "rate", set: { convert_location: true } },
        { id: "no", label: "نه", next: "rate" },
      ],
    },

    // ---- failure branch -------------------------------------------------

    why_failed: {
      id: "why_failed", kind: "choice", q: "چرا؟",
      sub: "ناموفق بودید، علت را بگو",
      options: [
        { id: "closed", label: "بسته بود", next: "reminder", set: { outcome: "VISIT_CLOSED" } },
        { id: "noowner", label: "صاحب‌ش نبود", next: "reminder", set: { outcome: "VISIT_NO_OWNER" } },
        { id: "wrongaddr", label: "آدرس اشتباه", next: "reminder", set: { outcome: "VISIT_WRONG_ADDRESS" } },
        { id: "newbuilding", label: "ساخته جدید", next: "reminder", set: { outcome: "VISIT_NEW_BUILDING" } },
      ],
    },

    /** A reminder is only worth offering when the driver might plausibly go back:
     *  a closed shop, an absent owner, a wrong address, a brand-new build. A lead that
     *  was simply not interested gets no reminder -- that is a skip, not a retry. */
    reminder: {
      id: "reminder", kind: "choice", q: "یادآوری بگذار؟",
      sub: "برای دوباره بازدید",
      options: [
        { id: "tomorrow", label: "بله + یک روز", tone: "rec", next: "rate",
          set: { next_title: AGAIN, next_kind: "reminder", due: TOMORROW_10 } },
        { id: "never", label: "نه", next: "rate" },
      ],
    },

    /** Step last in both branches. The stars map to rating_potential/volume/ease, so
     *  the row's score is filled in here rather than in a separate sheet. */
    rate: {
      id: "rate", kind: "stars", q: "ارزیابی",
      sub: "پتانسیل فروش و راحتی دسترسی را بزن",
      options: [{ id: "stars", label: "ارزیابی", next: "skip" }],
    },

    skip: SKIP_STEP,
  },
};