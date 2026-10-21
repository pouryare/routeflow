import type { FlowConfig, FlowContext, FlowOption } from "@/lib/crm/flows/types";
import { addDaysIso } from "@/lib/flows/dates";
import { faJalaliDate } from "@/lib/jalali";

/** Adding a stop to the visit plan: who, then which day. The day being looked at on the planner is
 *  the suggestion (so adding to it is two taps and no typing); today, tomorrow and a calendar day
 *  are the alternatives.
 *
 *  `ctx.items` carries both kinds of candidate in one list: a customer is its own (positive) id, a
 *  saved lead location is the NEGATIVE of its id, so the two id spaces cannot collide. The pick
 *  step's answer is a string, "c<id>" or "l<id>".
 *
 *  Contract: vars.today, vars.selected (the day on screen), optional vars.entity ("c5"/"l9") when
 *  the screen already knows who; values.who, values.day_pick, put values.planned. */
type Vals = { values: Record<string, string> };

export function whoChoices(ctx: FlowContext): { id: string; label: string }[] {
  return (ctx.items ?? []).map((i) => ({ id: i.id < 0 ? `l${-i.id}` : `c${i.id}`, label: i.label }));
}

const entityOf = (ctx: FlowContext, st: Vals): string => ctx.vars.entity ?? st.values.who;

export const visitPlanFlow: FlowConfig = {
  id: "visit_plan",
  start: (ctx) => (ctx.vars.entity ? "day" : "who"),
  budget: { common: 2, longest: 4 },
  steps: {
    who: {
      id: "who",
      kind: "pick",
      q: "چه کسی را به برنامه اضافه کنیم؟",
      choices: (ctx) => whoChoices(ctx),
      options: [{ id: "pick", label: "ادامه", next: "day" }],
    },
    day: {
      id: "day",
      kind: "choice",
      q: "برای کدام روز؟",
      options: (ctx): FlowOption[] => {
        const { today, selected } = ctx.vars;
        const day = (id: string, label: string, iso: string, rec = false): FlowOption => ({
          id, label, sub: faJalaliDate(iso), tone: rec ? "rec" : undefined, save: true, put: { planned: iso },
        });
        return [
          day("selected", selected === today ? "امروز" : "همین روز", selected, true),
          ...(selected === today ? [] : [day("today", "امروز", today)]),
          ...(selected === addDaysIso(today, 1) ? [] : [day("tomorrow", "فردا", addDaysIso(today, 1))]),
          { id: "other", label: "روز دیگر…", next: "day_pick" },
        ];
      },
    },
    day_pick: {
      id: "day_pick",
      kind: "date",
      q: "کدام روز؟",
      options: [{ id: "ok", label: "اضافه به برنامه", tone: "rec", save: true }],
    },
  },
};

/** The body POST /api/visit-plans expects. */
export function visitPlanRequest(ctx: FlowContext, st: Vals) {
  const e = entityOf(ctx, st);
  return {
    entity_type: e.startsWith("l") ? ("lead_location" as const) : ("customer" as const),
    entity_id: Number(e.slice(1)),
    planned_date: st.values.day_pick ?? st.values.planned,
  };
}

export function visitPlanChips(ctx: FlowContext, st: Vals): string[] {
  const e = entityOf(ctx, st);
  const name = whoChoices(ctx).find((c) => c.id === e)?.label.replace(/ \(.*\)$| · سرنخ$/, "") ?? "مورد انتخاب‌شده";
  return [name, `برنامهٔ ${faJalaliDate(visitPlanRequest(ctx, st).planned_date)}`];
}
