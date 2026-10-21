import type { FlowConfig, FlowContext, FlowState } from "@/lib/crm/flows/types";
import { faToman } from "@/lib/format";
import { roundToman } from "@/lib/money";

/** At the door: was everything handed over, and what was collected.
 *
 *  Common path -- «بله، همه» then «کل مبلغ» -- is two taps, because that is what happens most
 *  days. The stepper only appears when something was short, and starts on what was ordered,
 *  so correcting one line is one tap, not retyping every quantity.
 *
 *  The step ids and `put` keys are the contract with `deliveryPayload` below:
 *    counts    "ordered" when everything was handed over
 *    short     JSON { [lineId]: packs } from the stepper
 *    reason    why it was short (becomes the stop's note)
 *    collected "total" | "0" from the cash question
 *    collected_amount  the typed amount (an `amount` step stores under its input field)
 *
 *  The host passes `withTotals(ctx, state)` as the ctx it renders with, so «کل مبلغ» always
 *  shows the DELIVERED total, not the ordered one. */
const REASONS: Record<string, string> = {
  stock: "موجودی کم بود",
  refused: "مشتری نپذیرفت",
  damaged: "خراب بود",
  other: "سایر",
};

export const deliveryFlow: FlowConfig = {
  id: "delivery",
  start: () => "all",
  budget: { common: 2, longest: 5 },
  steps: {
    all: {
      id: "all",
      kind: "choice",
      q: "همهٔ اقلام تحویل شد؟",
      sub: "{customer} · جمع {total_label}",
      options: [
        { id: "yes", label: "بله، همه", sub: "تعداد همان سفارش است", tone: "rec", next: "cash", put: { counts: "ordered" } },
        { id: "no", label: "نه، کم شد", sub: "تعداد هر قلم را اصلاح می‌کنید", next: "short" },
      ],
    },
    short: {
      id: "short",
      kind: "stepper",
      q: "از هر قلم چند بسته تحویل شد؟",
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "why" }],
    },
    why: {
      id: "why",
      kind: "choice",
      q: "چرا کم شد؟",
      options: Object.entries(REASONS).map(([id, label]) => ({ id, label, next: "cash", put: { reason: label } })),
    },
    cash: {
      id: "cash",
      kind: "choice",
      q: "پول گرفتید؟",
      sub: "جمع تحویل: {total_label}",
      options: [
        { id: "full", label: "کل مبلغ", sub: "{total_label}", tone: "rec", save: true, put: { collected: "total" } },
        { id: "none", label: "چیزی نگرفتم", sub: "به حساب مشتری می‌ماند", save: true, put: { collected: "0" } },
        { id: "other", label: "مبلغ دیگر…", next: "amount" },
      ],
    },
    amount: {
      id: "amount",
      kind: "amount",
      q: "چقدر گرفتید؟",
      input: { field: "collected_amount", placeholder: "مبلغ به تومان", ltr: true },
      options: [{ id: "ok", label: "ثبت", tone: "rec", save: true }],
    },
  },
};

/** Packs delivered per line: what was ordered, or what the stepper said. */
export function deliveredCounts(ctx: FlowContext, st: FlowState): Record<number, number> {
  const items = ctx.items ?? [];
  if (st.values.short) {
    const said = JSON.parse(st.values.short) as Record<string, number>;
    return Object.fromEntries(items.map((i) => [i.id, Number(said[i.id] ?? 0)]));
  }
  return Object.fromEntries(items.map((i) => [i.id, i.qty ?? 0]));
}

/** What the customer owes for what was actually handed over. Same rounding as the server. */
export function deliveredTotal(ctx: FlowContext, st: FlowState): number {
  const counts = deliveredCounts(ctx, st);
  return (ctx.items ?? []).reduce((sum, i) => sum + roundToman((counts[i.id] ?? 0) * (i.price ?? 0)), 0);
}

/** The context to RENDER with: the delivered total in the placeholders, and the prefill for the
 *  typed-amount step. The host keeps the original ctx for starting and undoing the flow. */
export function withTotals(ctx: FlowContext, st: FlowState): FlowContext {
  const total = deliveredTotal(ctx, st);
  return { ...ctx, vars: { ...ctx.vars, total_label: faToman(total), collected_amount: String(total) } };
}

/** The exact body POST /api/driver/stops/:id expects. */
export function deliveryPayload(ctx: FlowContext, st: FlowState) {
  const counts = deliveredCounts(ctx, st);
  const total = deliveredTotal(ctx, st);
  const collected =
    st.values.collected_amount !== undefined ? Number(st.values.collected_amount)
    : st.values.collected === "total" ? total
    : Number(st.values.collected ?? 0);
  return {
    lines: (ctx.items ?? []).map((i) => ({ line_id: i.id, packs_delivered: counts[i.id] ?? 0 })),
    collected_toman: collected,
    notes: st.values.reason ?? null,
  };
}

/** What the done screen lists: every recorded fact, nothing implied. */
export function deliveryChips(ctx: FlowContext, st: FlowState): string[] {
  const counts = deliveredCounts(ctx, st);
  const full = (ctx.items ?? []).every((i) => (counts[i.id] ?? 0) === (i.qty ?? 0));
  const { collected_toman } = deliveryPayload(ctx, st);
  return [
    full ? "تحویل کامل" : "تحویل ناقص",
    ...(st.values.reason ? [`دلیل: ${st.values.reason}`] : []),
    `دریافتی: ${faToman(collected_toman)}`,
  ];
}
