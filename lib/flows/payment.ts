import type { FlowConfig, FlowContext, FlowState } from "@/lib/crm/flows/types";
import { faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";

/** Money received. Cash for a customer already on screen is two taps: «نقد», then the amount,
 *  which arrives prefilled with what the customer owes and is confirmed with one tap.
 *
 *  Step ids and the keys they store under are the contract with `paymentRequest`:
 *    who          the customer id (a `pick` step stores under its step id)
 *    method       `put.method`
 *    reference    the card/POS tracking number (optional)
 *    cheque_no    required for a cheque
 *    bank_name    `put.bank_name` from the bank chips
 *    due          the cheque's due date, ISO (a `date` step stores under its step id)
 *    amount       the amount; one step serves cash and cheque, so the cheque path asks for it last
 *
 *  `CREDIT_NOTE` is deliberately absent: it is produced by the system when goods come back,
 *  not collected at a door. The desk form still offers it. */
export const METHOD_LABEL: Record<string, string> = {
  CASH: "نقد",
  POS: "کارت‌خوان",
  CARD_TO_CARD: "کارت به کارت",
  CHEQUE: "چک",
  OTHER: "سایر",
};

const BANKS: { id: string; label: string }[] = [
  { id: "melli", label: "ملی" },
  { id: "mellat", label: "ملت" },
  { id: "saderat", label: "صادرات" },
  { id: "tejarat", label: "تجارت" },
  { id: "parsian", label: "پارسیان" },
];

/** A screen that is only ever about cheques (the cheques board) passes `vars.method = "CHEQUE"`,
 *  and the flow skips the method question rather than asking the one thing it already knows. */
const firstAfterWho = (ctx: FlowContext): string => (ctx.vars.method === "CHEQUE" ? "cheque_no" : "method");

export const paymentFlow: FlowConfig = {
  id: "payment",
  start: (ctx) => (ctx.vars.customer_id ? firstAfterWho(ctx) : "who"),
  budget: { common: 2, longest: 6 },
  steps: {
    who: {
      id: "who",
      kind: "pick",
      q: "از کدام مشتری دریافت کردید؟",
      choices: (ctx) => ctx.recentCustomers.map((c) => ({ id: String(c.id), label: c.name })),
      options: [{ id: "pick", label: "ادامه", next: (ctx) => firstAfterWho(ctx) }],
    },
    method: {
      id: "method",
      kind: "choice",
      q: "چطور پرداخت شد؟",
      sub: "{customer}",
      options: [
        { id: "CASH", label: METHOD_LABEL.CASH, next: "amount", put: { method: "CASH" } },
        { id: "POS", label: METHOD_LABEL.POS, next: "ref", put: { method: "POS" } },
        { id: "CARD_TO_CARD", label: METHOD_LABEL.CARD_TO_CARD, next: "ref", put: { method: "CARD_TO_CARD" } },
        { id: "CHEQUE", label: METHOD_LABEL.CHEQUE, sub: "شمارهٔ چک و سررسید پرسیده می‌شود", next: "cheque_no", put: { method: "CHEQUE" } },
        { id: "OTHER", label: METHOD_LABEL.OTHER, next: "amount", put: { method: "OTHER" } },
      ],
    },
    ref: {
      id: "ref",
      kind: "input",
      q: "شمارهٔ پیگیری",
      sub: "اختیاری؛ برای تطبیق با گزارش بانک",
      input: { field: "reference", placeholder: "شمارهٔ پیگیری (اختیاری)", ltr: true, optional: true },
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "amount" }],
    },
    cheque_no: {
      id: "cheque_no",
      kind: "input",
      q: "شمارهٔ چک چند است؟",
      input: { field: "cheque_no", placeholder: "شمارهٔ چک", ltr: true },
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "bank" }],
    },
    bank: {
      id: "bank",
      kind: "choice",
      q: "چک مال کدام بانک است؟",
      options: [
        ...BANKS.map((b) => ({ id: b.id, label: b.label, next: "due", put: { bank_name: b.label } })),
        { id: "other_bank", label: "بانک دیگر", next: "due", put: { bank_name: "" } },
      ],
    },
    due: {
      id: "due",
      kind: "date",
      q: "سررسید چک کی است؟",
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "amount" }],
    },
    amount: {
      id: "amount",
      kind: "amount",
      q: "چقدر دریافت کردید؟",
      sub: "{owed_line}",
      input: { field: "amount", placeholder: "مبلغ به تومان", ltr: true },
      options: [{ id: "ok", label: "ثبت دریافت", tone: "rec", save: true }],
    },
  },
};

/** The customer this flow is about: fixed by the screen it opened from, or picked first. */
export function customerIdOf(ctx: FlowContext, st: FlowState): number {
  return Number(ctx.vars.customer_id ?? st.values.who);
}

/** The method answered in the flow, or the one the opening screen fixed. */
export const methodOf = (ctx: FlowContext, st: FlowState): string => st.values.method ?? ctx.vars.method ?? "";

/** Which endpoint, and the exact body it expects. A cheque goes to /api/cheques, which records
 *  the cheque and its payment in one transaction; everything else to /api/payments. The server
 *  allocates the money to the oldest unpaid orders itself. */
export function paymentRequest(ctx: FlowContext, st: FlowState): { url: string; body: Record<string, unknown> } {
  const customer_id = customerIdOf(ctx, st);
  const amount_toman = Number(st.values.amount);
  const received_at = ctx.vars.received_at;
  if (methodOf(ctx, st) === "CHEQUE") {
    return {
      url: "/api/cheques",
      body: {
        customer_id,
        amount_toman,
        cheque_no: st.values.cheque_no,
        bank_name: st.values.bank_name || null,
        due_date: st.values.due,
        received_at,
      },
    };
  }
  return {
    url: "/api/payments",
    body: {
      customer_id,
      amount_toman,
      method: methodOf(ctx, st),
      received_at,
      reference: st.values.reference || null,
      note: null,
    },
  };
}

/** Every recorded fact for the done screen, including the date that was used by default. */
export function paymentChips(ctx: FlowContext, st: FlowState): string[] {
  const id = customerIdOf(ctx, st);
  const name = ctx.vars.customer ?? ctx.recentCustomers.find((c) => c.id === id)?.name ?? null;
  const m = methodOf(ctx, st);
  const method = METHOD_LABEL[m] ?? m;
  return [
    ...(name ? [name] : []),
    `${method}: ${faToman(Number(st.values.amount))}`,
    ...(m === "CHEQUE" ? [`چک ${st.values.cheque_no} · سررسید ${faJalaliDate(st.values.due)}`] : []),
    ...(st.values.reference ? [`پیگیری ${st.values.reference}`] : []),
    `تاریخ: ${faJalaliDate(ctx.vars.received_at)}`,
  ];
}
