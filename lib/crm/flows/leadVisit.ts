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
      skipable: true,
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
        { id: "buy", label: "آماده خرید", next: "sold", set: { outcome: "READY_TO_BUY" } },
        { id: "partial", label: PARTIAL, next: "rate", set: { outcome: "INTERESTED", handoff_sales: true } },
        { id: "closed", label: "بسته بود", next: "rate", set: { outcome: "VISIT_CLOSED" } },
        { id: "noowner", label: "صاحب‌ش نبود", next: "rate", set: { outcome: "VISIT_NO_OWNER" } },
      ],
    },

    /** They are ready to buy, so somebody has to write the order down.
     *
     *  This step used to be `convert`: "تبدیل به مشتری؟", asked of the driver, answering
     *  yes or no. It was wrong twice over. A driver cannot make a commercial decision --
     *  the lead becomes a customer when it buys, and buying is the office's paperwork, not
     *  a tap at the door. And the answer went nowhere: `convert_location` was written to
     *  the visit's accumulator and read by nothing at all, so the question was a lie that
     *  cost a tap and stored a discarded opinion. The comment in write.ts claimed "the
     *  caller opens the existing convert route"; no caller ever did.
     *
     *  Both answers here create the order task, because a ready buyer who walks away
     *  unrecorded is the exact failure this work exists to stop. They differ in urgency and
     *  in the shortcut: "now" also sets open_order, which is the flag AfterCallFlow already
     *  reads to offer the order page, so the sale can be written down before the van
     *  leaves the kerb. That flag and the next_kind/due pair are the existing mechanism,
     *  copied from afterCall.ts rather than invented for the visit. */
    sold: {
      id: "sold", kind: "choice", q: "همین حالا سفارش می‌دهند؟",
      sub: "اگر همین حالا خرید کردند، ثبتش کن",
      options: [
        { id: "now", label: "بله، همین حالا", tone: "rec", next: "rate",
          set: { next_title: "ثبت سفارش", next_kind: "order", due: { kind: "in_hours", hours: 0 }, open_order: true } },
        { id: "office", label: "فعلاً نه، دفتر پیگیری کند", next: "rate",
          set: { next_title: "ثبت سفارش", next_kind: "order", due: TOMORROW_10 } },
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