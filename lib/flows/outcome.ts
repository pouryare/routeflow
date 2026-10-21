import type { FlowConfig, FlowContext, FlowOption, FlowState } from "@/lib/crm/flows/types";

/** How a task that is not about a customer's call ended: one question, one tap, saved with the
 *  5 s undo. (A task about a customer opens the after-call flow instead, which asks far more.)
 *
 *  The codes are the ones the old pills sent and the server's objection cards are keyed by, so
 *  nothing downstream changes; only the words are now a full sentence a person would say.
 *
 *  `vars.allow_none = "1"` adds «بدون نتیجه», for the board, where a card can be closed without
 *  anything having been said. */
export const TASK_OUTCOME_LABEL: Record<string, string> = {
  CONTACTED: "با او صحبت شد",
  ORDERED: "سفارش داد",
  PRICE_OBJECTION: "قیمت را زیاد دانست",
  NOT_INTERESTED: "علاقه‌ای ندارد",
};

export const outcomeFlow: FlowConfig = {
  id: "outcome",
  start: () => "result",
  budget: { common: 1, longest: 1 },
  steps: {
    result: {
      id: "result",
      kind: "choice",
      q: "نتیجهٔ این کار چه بود؟",
      sub: "{task}",
      options: (ctx: FlowContext): FlowOption[] => [
        ...Object.entries(TASK_OUTCOME_LABEL).map(([code, label]) => ({
          id: code,
          label,
          save: true,
          put: { outcome_code: code },
        })),
        ...(ctx.vars.allow_none === "1"
          ? [{ id: "none", label: "بدون نتیجه", sub: "کار بسته می‌شود، چیزی ثبت نمی‌شود", save: true, put: { outcome_code: "" } }]
          : []),
      ],
    },
  },
};

/** The outcome code to send, or null when the task was closed with no result. */
export function outcomeCode(st: FlowState): string | null {
  return st.values.outcome_code ? st.values.outcome_code : null;
}

/** What the done screen lists. */
export function outcomeChips(st: FlowState): string[] {
  const code = outcomeCode(st);
  return [code ? (TASK_OUTCOME_LABEL[code] ?? "نتیجهٔ دیگر") : "بدون نتیجه"];
}
