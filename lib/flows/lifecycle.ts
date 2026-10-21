import type { FlowConfig, FlowContext, FlowOption, FlowState } from "@/lib/crm/flows/types";
import { LIFECYCLE_TRANSITIONS } from "@/lib/customerLifecycle";
import { LIFECYCLE_LABEL, type CustomerLifecycle } from "@/lib/types";

/** Moving a customer along their lifecycle.
 *
 *  The options are not written here: they ARE `LIFECYCLE_TRANSITIONS[from]`, so the flow can
 *  never offer a move the server refuses, and a transition added to the table appears in the
 *  sheet by itself. What this file adds is the sentence under each one, saying what the move
 *  means, and the extra question before the two that end a relationship.
 *
 *  Moves that end something (lost, blocked) are tinted and ask once more, offering the gentler
 *  alternative («فقط غیرفعال شود») when the table allows it -- docs/tap-flow-principles.md rule 7.
 *  Every move also has the 5 s undo. The server stores only the new state (there is nowhere to
 *  keep a reason), so none is asked for.
 *
 *  Contract: vars.from, vars.customer; values.to = the target state. */
export const DESTRUCTIVE: CustomerLifecycle[] = ["lost", "blocked"];

const MEANING: Record<CustomerLifecycle, string> = {
  lead: "دوباره سرنخ می‌شود و می‌توان پیگیری‌اش را از اول شروع کرد",
  qualified: "سرنخی که پیگیری‌اش ادامه دارد",
  sampled: "نمونه به او داده شده است",
  active: "مشتری فعال است",
  dormant: "مدتی خرید نکرده؛ هر وقت برگشت دوباره فعال می‌شود",
  lost: "از دست‌رفته علامت می‌خورد؛ بعداً می‌توان دوباره سرنخ کرد",
  blocked: "مسدود علامت می‌خورد",
};

const from = (ctx: FlowContext) => ctx.vars.from as CustomerLifecycle;

export const lifecycleFlow: FlowConfig = {
  id: "lifecycle",
  start: () => "to",
  budget: { common: 1, longest: 2 },
  steps: {
    to: {
      id: "to",
      kind: "choice",
      q: "وضعیت جدید چیست؟",
      sub: "{customer} · الان «{from_label}»",
      options: (ctx): FlowOption[] =>
        LIFECYCLE_TRANSITIONS[from(ctx)].map((to) =>
          DESTRUCTIVE.includes(to)
            ? { id: to, label: LIFECYCLE_LABEL[to], sub: MEANING[to], tone: "bad", next: "sure", put: { to } }
            : { id: to, label: LIFECYCLE_LABEL[to], sub: MEANING[to], save: true, put: { to } },
        ),
    },
    sure: {
      id: "sure",
      kind: "choice",
      q: "این تغییر ثبت شود؟",
      sub: (ctx, s) => `${ctx.vars.customer ?? ""} · «${LIFECYCLE_LABEL[from(ctx)]}» ← «${LIFECYCLE_LABEL[s.values.to as CustomerLifecycle]}»`,
      options: (ctx, s): FlowOption[] => {
        const to = s.values.to as CustomerLifecycle;
        const gentler = LIFECYCLE_TRANSITIONS[from(ctx)].includes("dormant");
        return [
          { id: "yes", label: `بله، «${LIFECYCLE_LABEL[to]}» شود`, tone: "bad", save: true },
          ...(gentler
            ? [{ id: "gentler", label: `فقط «${LIFECYCLE_LABEL.dormant}» شود`, sub: MEANING.dormant, save: true, put: { to: "dormant" } }]
            : []),
        ];
      },
    },
  },
};

/** The state to send. */
export const lifecycleTarget = (st: Pick<FlowState, "values">): CustomerLifecycle => st.values.to as CustomerLifecycle;

/** Every recorded fact for the done screen and the toast. */
export function lifecycleChips(ctx: FlowContext, st: Pick<FlowState, "values">): string[] {
  return [ctx.vars.customer ?? "مشتری", `${LIFECYCLE_LABEL[from(ctx)]} ← ${LIFECYCLE_LABEL[lifecycleTarget(st)]}`];
}
