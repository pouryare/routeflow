import { SIZE_BANDS, SIZE_BAND_LABEL, SUPPLY_CHANNELS, SUPPLY_CHANNEL_LABEL, VISIT_WINDOWS, VISIT_WINDOW_LABEL } from "../intel";
import type { FlowConfig } from "./types";

/** Business facts only: no sales outcome, attempt, temperature or next task. */
export const intelFlow: FlowConfig = {
  id: "intel", start: () => "size", budget: { common: 5, longest: 5 },
  steps: {
    size: { id: "size", kind: "choice", q: "«{name}» چقدر بزرگ است؟", options: SIZE_BANDS.map(b => ({ id: b, label: SIZE_BAND_LABEL[b], next: "supply", set: { size_band: b } })) },
    supply: { id: "supply", kind: "choice", q: "الان از کجا خرید می‌کند؟", options: SUPPLY_CHANNELS.map(c => ({ id: c, label: SUPPLY_CHANNEL_LABEL[c], next: "uses", set: { supply_channel: c } })) },
    uses: { id: "uses", kind: "multi", q: "کدام کالای ما را الان مصرف می‌کند؟", sub: "اختیاری؛ اگر نمی‌دانید بدون انتخاب ادامه دهید", choices: ctx => ctx.products.map(p => ({ id: String(p.id), label: p.name })), options: [{ id: "ok", label: "ادامه به سؤال بعد", next: "when" }] },
    when: { id: "when", kind: "choice", q: "بهترین وقت سر زدن؟", options: VISIT_WINDOWS.map(w => ({ id: w, label: VISIT_WINDOW_LABEL[w], next: "note", set: { visit_window: w } })) },
    note: { id: "note", kind: "input", q: "نکته‌ای برای کسی که سر می‌زند؟", input: { field: "visit_note", placeholder: "سراغ چه کسی برویم؟", optional: true }, options: [{ id: "ok", label: "ثبت این شناخت", tone: "rec", save: true }] },
  },
};
