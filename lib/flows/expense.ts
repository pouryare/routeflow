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
 *  The server has no supplier column on an expense, so the supplier is written into the journal
 *  memo. The receipt photo is optional: the host takes it (camera) and uploads it to the new
 *  expense once the expense itself is saved (values.photo is "take" when there is one).
 *
 *  Contract with `expenseRequest`: values.category (account id, from the pick step), values.amount,
 *  values.supplier (a name, optional), values.method, answered option `take` on the photo step; vars.today; ctx.lists.category (accounts),
 *  ctx.lists.supplier (recent names). */
type Vals = { values: Record<string, string>; answers?: { step: string; option: string }[] };

/** The ways to pay that map to a cash or bank account on the ledger. */
export const EXPENSE_METHODS = ["CASH", "POS", "CARD_TO_CARD"] as const;

export const expenseFlow: FlowConfig = {
  id: "expense",
  start: () => "category",
  budget: { common: 5, longest: 5 },
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
      options: EXPENSE_METHODS.map((m): FlowOption => ({ id: m, label: METHOD_LABEL[m], next: "photo", put: { method: m } })),
    },
    photo: {
      id: "photo",
      kind: "photo",
      q: "از رسید عکس بگیریم؟",
      sub: "اختیاری؛ عکس کنار این هزینه نگه داشته می‌شود",
      options: [
        { id: "take", label: "عکس رسید", tone: "rec", save: true },
        { id: "none", label: "بدون عکس", save: true },
      ],
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
    ...(hasPhoto(st) ? ["با عکس رسید"] : []),
  ];
}

/** Did the person take a receipt photo? (The photo step is the last; its answer is recorded.) */
export const hasPhoto = (st: { answers?: { step: string; option: string }[] }): boolean =>
  (st.answers ?? []).some((a) => a.step === "photo" && a.option === "take");
