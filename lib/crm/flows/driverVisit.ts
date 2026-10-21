import { roleOptions, TOMORROW_10 } from "./common";
import type { FlowConfig } from "./types";

const backToRep = { next_title: "تماس اول پس از بازدید", next_kind: "call", next_assignee: "owner", due: TOMORROW_10 } as const;

/** What a driver answers at the door of a phone-less lead. The driver's GPS at save time
 *  fixes the exact pin (sent beside the answers, not as one). */
export const driverVisitFlow: FlowConfig = {
  id: "driver_visit",
  start: () => "found",
  budget: { common: 5, longest: 5 },
  steps: {
    found: {
      id: "found", kind: "choice", q: "«{name}» را پیدا کردید؟", sub: "{address}",
      options: [
        { id: "yes", label: "بله، پیدا کردم", tone: "rec", next: "open" },
        { id: "no", label: "پیدا نشد", tone: "bad", next: "notfound" },
      ],
    },
    notfound: {
      id: "notfound", kind: "choice", q: "چه شد؟",
      options: [
        { id: "closed", label: "تعطیل شده بود", tone: "bad", save: true, set: { verification: "invalid_closed", outcome: "INVALID", invalid: true, lost_reason: "CLOSED", due: { kind: "none" } } },
        { id: "gone", label: "این‌جا چنین جایی نیست", save: true, set: { verification: "invalid_not_found", outcome: "INVALID", invalid: true, due: { kind: "none" } } },
        { id: "wrongpin", label: "آدرس اشتباه بود", save: true, set: { outcome: "VISIT_CLOSED", next_title: "پیدا کردن آدرس درست", next_kind: "outreach", next_assignee: "owner", due: TOMORROW_10 } },
      ],
    },
    open: {
      id: "open", kind: "choice", q: "باز بود؟",
      options: [
        { id: "yes", label: "بله، باز بود", tone: "rec", next: "phone", set: { verification: "verified" } },
        { id: "shut", label: "بسته بود", sub: "بعداً دوباره سر می‌زنیم", save: true, set: { verification: "verified", outcome: "VISIT_CLOSED", next_title: "بازدید دوباره", next_kind: "verify_visit", next_assignee: "driver_pool", due: { kind: "in_days", days: 2, hour: 12 } } },
      ],
    },
    phone: {
      id: "phone", kind: "input", q: "شمارهٔ تماس گرفتید؟", sub: "بهتر است شمارهٔ مسئول خرید باشد",
      input: { field: "new_phone", placeholder: "09__ ___ ____", ltr: true, optional: true },
      options: [{ id: "ok", label: "ادامه به سؤال بعد", tone: "rec", next: "who" }],
    },
    who: {
      id: "who", kind: "roles", q: "با چه کسی صحبت کردید؟", input: { field: "contact_name", placeholder: "نام (اختیاری)…", optional: true },
      options: roleOptions("interest", "interest"),
    },
    interest: {
      id: "interest", kind: "choice", q: "علاقه نشان دادند؟",
      options: [
        { id: "yes", label: "بله، گفتند زنگ بزنید", tone: "rec", save: true, set: { outcome: "INTERESTED", ...backToRep } },
        { id: "neutral", label: "نه خیلی، نه کم", save: true, set: { outcome: "TALKED", ...backToRep } },
        { id: "no", label: "علاقه نداشتند", save: true, set: { outcome: "NOT_INTERESTED", ...backToRep } },
      ],
    },
  },
};
