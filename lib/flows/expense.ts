import type { FlowConfig, FlowContext, FlowOption } from "@/lib/crm/flows/types";
import { faNum, faToman } from "@/lib/format";
import { METHOD_LABEL } from "@/lib/flows/payment";

/** Writing down money the business spent: what for, how much, who from, how it was paid.
 *
 *  The day is today and is never asked (an older expense is entered from the desk). The
 *  category list is the live chart of expense accounts, so a retired account never appears and
 *  COGS never does. Paying methods are the three that are real money on the spot; cheques and
 *  credit notes are not expenses paid at a counter.
 *
 *  The server has no supplier or photo column on an expense, so the supplier is written into the
 *  journal memo, and photo capture is parked (docs/future-features.md F1).
 *
 *  Contract with `expenseRequest`: values.category (account id, from the pick step), values.amount,
 *  values.supplier (a name, optional), values.method; vars.today; ctx.lists.category (accounts),
 *  ctx.lists.supplier (recent names). */
type Vals = { values: Record<string, string> };

/** The ways to pay that map to a cash or bank account on the ledger. */
export const EXPENSE_METHODS = ["CASH", "POS", "CARD_TO_CARD"] as const;

export const expenseFlow: FlowConfig = {
  id: "expense",
  start: () => "category",
  budget: { common: 4, longest: 4 },
  steps: {
    category: {
      id: "category",
      kind: "pick",
      q: "این هزینه برای چیست؟",
      choices: (ctx) => (ctx.lists?.category ?? []).map((c) => ({ id: String(c.id), label: c.label })),
      options: [{ id: "pick", label: "ادامه", next: "amount" }],
    },
    amount: {
      id: "amount",
      kind: "amount",
      q: "چقدر پرداخت شد؟",
      input: { field: "amount", placeholder: "مبلغ (تومان)", ltr: true },
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "supplier" }],
    },
    supplier: {
      id: "supplier",
      kind: "choice",
      q: "به چه کسی پرداخت شد؟",
      options: (ctx): FlowOption[] => [
        ...(ctx.lists?.supplier ?? []).map((s): FlowOption => ({ id: `s${s.id}`, label: s.label, next: "method", put: { supplier: s.label } })),
        { id: "nosup", label: "بدون نام", next: "method" },
      ],
    },
    method: {
      id: "method",
      kind: "choice",
      q: "چطور پرداخت شد؟",
      sub: (ctx, s) => `${categoryName(ctx, s)} · ${faToman(Number(s.values.amount))}`,
      options: EXPENSE_METHODS.map((m): FlowOption => ({ id: m, label: METHOD_LABEL[m], save: true, put: { method: m } })),
    },
  },
};

const categoryName = (ctx: FlowContext, st: Vals) =>
  (ctx.lists?.category ?? []).find((c) => String(c.id) === st.values.category)?.label ?? "هزینه";

/** The body POST /api/accounting/expenses expects. */
export function expenseRequest(ctx: FlowContext, st: Vals) {
  return {
    account_id: Number(st.values.category),
    amount_toman: Math.round(Number(st.values.amount)),
    method: st.values.method,
    incurred_at: ctx.vars.today,
    memo: st.values.supplier ? `پرداخت به ${st.values.supplier}` : null,
  };
}

/** Every recorded fact for the done screen and the toast. */
export function expenseChips(ctx: FlowContext, st: Vals): string[] {
  return [
    categoryName(ctx, st),
    `${faNum(Math.round(Number(st.values.amount)))} تومان`,
    ...(st.values.supplier ? [st.values.supplier] : []),
    METHOD_LABEL[st.values.method] ?? "نامشخص",
  ];
}
