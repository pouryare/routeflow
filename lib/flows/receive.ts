import type { FlowConfig, FlowContext, FlowOption } from "@/lib/crm/flows/types";
import { faNum, faToman } from "@/lib/format";
import { faJalaliDate } from "@/lib/jalali";
import { roundToman } from "@/lib/money";

/** Goods arriving at the door: which product, how many, at what price, from whom, and until when
 *  they keep. One product per flow -- a delivery of several is several short flows, and the desk
 *  form with its line table stays for an invoice.
 *
 *  This records a PURCHASE (`POST /api/sales/purchases`), not just a batch: the purchase is what
 *  puts the goods on the ledger as stock (and moves the average cost), whereas a bare batch row
 *  would exist with nothing on hand. So it is owner-only, like the desk form, and asks for the
 *  price; it arrives prefilled with the product's current average cost so confirming is one tap.
 *
 *  Contract with `receiveRequest`: values.product (id), values.qty, values.cost, values.supplier
 *  (a name), values.expiry (ISO); vars.today, vars.unit, vars.product (name) and vars.cost (the
 *  prefill) are set by the host once a product is picked; ctx.items = recent suppliers. */
type Vals = { values: Record<string, string> };

export function receiveTotal(st: Vals): number {
  return roundToman(Number(st.values.qty) * Number(st.values.cost));
}

export const receiveFlow: FlowConfig = {
  id: "receive",
  start: () => "product",
  budget: { common: 6, longest: 6 },
  steps: {
    product: {
      id: "product",
      kind: "pick",
      q: "کدام کالا رسیده است؟",
      choices: (ctx) => ctx.products.map((p) => ({ id: String(p.id), label: p.name })),
      options: [{ id: "pick", label: "ادامه", next: "qty" }],
    },
    qty: {
      id: "qty",
      kind: "amount",
      q: "چقدر «{product}» رسید؟",
      input: { field: "qty", placeholder: "مقدار دریافتی", decimal: true },
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "cost" }],
    },
    cost: {
      id: "cost",
      kind: "amount",
      q: "قیمت هر {unit} چقدر است؟",
      sub: "{cost_line}",
      input: { field: "cost", placeholder: "قیمت هر واحد (تومان)", ltr: true },
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "supplier" }],
    },
    supplier: {
      id: "supplier",
      kind: "choice",
      q: "از چه کسی خریده شد؟",
      options: (ctx): FlowOption[] => [
        ...(ctx.items ?? []).map((s): FlowOption => ({ id: `s${s.id}`, label: s.label, next: "expiry", put: { supplier: s.label } })),
        { id: "nosup", label: "بدون تأمین‌کننده", next: "expiry" },
      ],
    },
    expiry: {
      id: "expiry",
      kind: "date",
      q: "تاریخ انقضای این محموله؟",
      sub: "برای خروج به‌ترتیب انقضا استفاده می‌شود",
      options: [
        { id: "ok", label: "ادامه", tone: "rec", next: "confirm" },
        { id: "none", label: "تاریخ انقضا ندارد", next: "confirm" },
      ],
    },
    confirm: {
      id: "confirm",
      kind: "choice",
      q: "دریافت ثبت شود؟",
      sub: (ctx, s) => {
        const name = ctx.products.find((p) => String(p.id) === s.values.product)?.name ?? ctx.vars.product;
        return `${name} · ${faNum(Number(s.values.qty), { maximumFractionDigits: 2 })} ${ctx.vars.unit ?? ""} · هر واحد ${faToman(Number(s.values.cost))} · جمع ${faToman(receiveTotal(s))}`;
      },
      options: [{ id: "ok", label: "ثبت دریافت", tone: "rec", save: true }],
    },
  },
};

/** The body POST /api/sales/purchases expects. */
export function receiveRequest(ctx: FlowContext, st: Vals) {
  return {
    supplier: st.values.supplier ? st.values.supplier : null,
    purchase_date: ctx.vars.today,
    invoice_no: null,
    lines: [
      {
        product_id: Number(st.values.product),
        base_qty: Number(st.values.qty),
        unit_cost_toman: Number(st.values.cost),
        expiry_date: st.values.expiry ? st.values.expiry : null,
      },
    ],
  };
}

/** Every recorded fact for the done screen. */
export function receiveChips(ctx: FlowContext, st: Vals): string[] {
  const name = ctx.products.find((p) => String(p.id) === st.values.product)?.name ?? ctx.vars.product;
  return [
    name,
    `${faNum(Number(st.values.qty), { maximumFractionDigits: 2 })} ${ctx.vars.unit ?? ""}`.trim(),
    `جمع ${faToman(receiveTotal(st))}`,
    st.values.supplier ? st.values.supplier : "بدون تأمین‌کننده",
    st.values.expiry ? `انقضا ${faJalaliDate(st.values.expiry)}` : "بدون تاریخ انقضا",
  ];
}
