import type { FlowConfig, FlowContext, FlowOption, FlowState } from "@/lib/crm/flows/types";
import { faJalaliDate } from "@/lib/jalali";

/** A reminder (a day and a few words) or a note (just the words), for yourself.
 *
 *  A reminder is mostly one of five things, so those are answers: pick the day, tap «تماس بگیرم»,
 *  done -- two taps and no keyboard. Typing is for the reminder nobody could have predicted.
 *
 *  Contract with `reminderRequest`:  vars.kind ("reminder"|"note"), vars.entity_type/entity_id
 *  (optional: a customer or district the reminder is about), vars.today;
 *  values.when (ISO day, from the `date` step) and values.text (a template or the typed text). */
export const REMINDER_TEMPLATES = ["تماس بگیرم", "پیگیری پرداخت", "ارسال قیمت‌ها", "پیگیری سفارش", "سر بزنم"];

const isNote = (ctx: FlowContext) => ctx.vars.kind === "note";

export const reminderFlow: FlowConfig = {
  id: "reminder",
  start: (ctx) => (isNote(ctx) ? "text" : "when"),
  budget: { common: 2, longest: 3 },
  steps: {
    when: {
      id: "when",
      kind: "date",
      q: "کی یادآوری شود؟",
      sub: "{entity}",
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "what" }],
    },
    what: {
      id: "what",
      kind: "choice",
      q: "چه چیزی را یادآوری کنیم؟",
      options: [
        ...REMINDER_TEMPLATES.map((t, i): FlowOption => ({ id: `t${i}`, label: t, save: true, put: { text: t } })),
        { id: "custom", label: "متن دیگر…", next: "text" },
      ],
    },
    text: {
      id: "text",
      kind: "input",
      q: "متن را بنویسید",
      input: { field: "text", placeholder: "متن", },
      options: (ctx: FlowContext): FlowOption[] => [
        { id: "ok", label: isNote(ctx) ? "ثبت یادداشت" : "ثبت یادآوری", tone: "rec", save: true },
      ],
    },
  },
};

/** Which endpoint and body. A district's reminder lives in `reminders`; everything else is a
 *  task (kind reminder/note) that lands in the person's own Pocket. */
export function reminderRequest(ctx: FlowContext, st: FlowState): { url: string; body: Record<string, unknown> } {
  const text = (st.values.text ?? "").trim();
  const type = ctx.vars.entity_type;
  const id = ctx.vars.entity_id ? Number(ctx.vars.entity_id) : null;
  if (type === "district" && id !== null) {
    return { url: "/api/reminders", body: { entity_type: "district", entity_id: id, due_date: st.values.when, message: text } };
  }
  const note = isNote(ctx);
  return {
    url: "/api/tasks",
    body: {
      title: text,
      kind: note ? "note" : "reminder",
      due_at: note ? null : st.values.when,
      ...(type === "customer" && id !== null ? { entity_type: "customer", entity_id: id } : {}),
    },
  };
}

/** Every recorded fact for the done screen. */
export function reminderChips(ctx: FlowContext, st: FlowState): string[] {
  const text = (st.values.text ?? "").trim();
  const shown = text.length > 30 ? `${text.slice(0, 30)}…` : text;
  return [
    isNote(ctx) ? "یادداشت" : "یادآوری",
    ...(isNote(ctx) ? [] : [faJalaliDate(st.values.when)]),
    ...(ctx.vars.entity ? [ctx.vars.entity] : []),
    `«${shown}»`,
  ];
}
