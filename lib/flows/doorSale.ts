import type { FlowConfig, FlowContext, FlowOption } from "@/lib/crm/flows/types";
import { faNum, faToman } from "@/lib/format";
import { orderCounts, orderLines, orderTotal, overCreditLimit } from "@/lib/flows/orderQuick";

/** The van at the door, as a tap flow (VC4, F52): who, sale or sample, how many of what, then the money.
 *  The last answer saves; there is no save button, and the toast offers the 5 s undo like every flow.
 *
 *  Items are what the van holds: `id` = packaging id, `parent` = product id, `max` = whole packs on the
 *  van, `price` = today's price per pack or undefined when the product has none. The server prices the
 *  sale itself; the price here is only for the total on screen.
 *
 *  Keys, the contract with `doorRequest`:
 *    who        picked customer id (when the screen did not fix one)
 *    kind       "sale" | "sample"
 *    adjust     JSON { [packagingId]: packs } from the stepper
 *    collected  cash taken now, in toman (sale only)
 *  vars: customer_id, customer, debt, credit_limit (optional) */
type Vals = { values: Record<string, string> };

const kindOf = (st: Vals): "sale" | "sample" => (st.values.kind === "sample" ? "sample" : "sale");

/** Lines chosen that have no price today; a sale cannot include them (a sample can). */
function unpriced(ctx: FlowContext, st: Vals): string[] {
  const counts = orderCounts(ctx, st);
  return (ctx.items ?? []).filter((i) => (counts[i.id] ?? 0) > 0 && i.price === undefined).map((i) => i.label);
}

export const doorSaleFlow: FlowConfig = {
  id: "door_sale",
  start: (ctx) => (ctx.vars.customer_id ? "mode" : "who"),
  budget: { common: 4, longest: 6 },
  steps: {
    who: {
      id: "who",
      kind: "pick",
      q: "برای کدام مشتری است؟",
      choices: (ctx) => ctx.recentCustomers.map((c) => ({ id: String(c.id), label: c.name })),
      options: [{ id: "pick", label: "ادامه", next: "mode" }],
    },
    mode: {
      id: "mode",
      kind: "choice",
      q: "چه چیزی تحویل می‌دهید؟",
      sub: "از کالای روی ماشین. کالایی که روی ماشین نیست در این فهرست نمی‌آید.",
      options: [
        { id: "sale", label: "فروش", sub: "پول را همین‌جا می‌گیرید یا نسیه", tone: "rec", next: "items", put: { kind: "sale" } },
        { id: "sample", label: "نمونهٔ رایگان", sub: "قیمتی ندارد و بدهی نمی‌سازد", next: "items", put: { kind: "sample" } },
      ],
    },
    items: {
      id: "items",
      kind: "stepper",
      q: "از هر قلم چند بسته؟",
      options: [
        {
          id: "ok",
          label: "ادامه",
          tone: "rec",
          next: (ctx, s) =>
            orderLines(ctx, s).length === 0 ? "empty"
            : kindOf(s) === "sale" ? (unpriced(ctx, s).length > 0 ? "unpriced" : "pay")
            : "sample_ok",
        },
      ],
    },
    empty: {
      id: "empty",
      kind: "choice",
      q: "هیچ قلمی انتخاب نشده",
      sub: "بدون قلم چیزی ثبت نمی‌شود.",
      options: [{ id: "back", label: "برگشت و اصلاح", next: "items" }],
    },
    unpriced: {
      id: "unpriced",
      kind: "choice",
      q: "یکی از کالاها قیمت ندارد",
      sub: (ctx, s) => `${unpriced(ctx, s).join("، ")} قیمت امروز ندارد و فروخته نمی‌شود. تعدادش را صفر کنید یا آن را نمونه بدهید.`,
      options: [{ id: "back", label: "برگشت و اصلاح", next: "items" }],
    },
    pay: {
      id: "pay",
      kind: "choice",
      q: "پول چطور شد؟",
      sub: (ctx, s) => {
        const parts = [`${faNum(orderLines(ctx, s).length)} قلم · جمع ${faToman(orderTotal(ctx, s))}`];
        const debt = Number(ctx.vars.debt ?? 0);
        if (debt > 0) parts.push(`بدهی قبلی مشتری ${faToman(debt)}`);
        if (overCreditLimit(ctx, s)) parts.push("سقف اعتبار رد می‌شود؛ ممکن است فروش منتظر تأیید مدیر بماند و کالا تحویل نشود.");
        return parts.join(" · ");
      },
      options: (ctx, s): FlowOption[] => [
        { id: "cash", label: "همهٔ پول را نقد گرفتم", sub: faToman(orderTotal(ctx, s)), tone: "rec", save: true, put: { collected: String(orderTotal(ctx, s)) } },
        { id: "credit", label: "نسیه، بعداً حساب می‌شود", sub: "بدهی مشتری می‌شود", save: true, put: { collected: "0" } },
        { id: "other", label: "مبلغ دیگری گرفتم", next: "amount" },
      ],
    },
    amount: {
      id: "amount",
      kind: "amount",
      q: "چقدر نقد گرفتید؟",
      sub: (ctx, s) => `جمع این فروش ${faToman(orderTotal(ctx, s))}`,
      input: { field: "collected", placeholder: "مبلغ دریافتی", allowZero: true },
      options: [{ id: "ok", label: "ثبت فروش", tone: "rec", save: true }],
    },
    sample_ok: {
      id: "sample_ok",
      kind: "choice",
      q: "نمونه ثبت شود؟",
      sub: (ctx, s) => `${faNum(orderLines(ctx, s).length)} قلم از روی ماشین کم می‌شود. بابت آن پولی گرفته نمی‌شود.`,
      options: [{ id: "ok", label: "ثبت نمونه", tone: "rec", save: true }],
    },
  },
};

/** Where the answers go, and the body to send. */
export function doorRequest(ctx: FlowContext, st: Vals, clientUuid: string): { url: string; body: Record<string, unknown> } {
  const base = {
    customer_id: Number(ctx.vars.customer_id ?? st.values.who),
    lines: orderLines(ctx, st),
    client_uuid: clientUuid,
  };
  return kindOf(st) === "sample"
    ? { url: "/api/driver/samples", body: base }
    : { url: "/api/driver/door-sale", body: { ...base, collected_toman: Number(st.values.collected ?? 0) } };
}

/** What was recorded, for the toast and the done screen. */
export function doorChips(ctx: FlowContext, st: Vals): string[] {
  const id = Number(ctx.vars.customer_id ?? st.values.who);
  const name = ctx.vars.customer ?? ctx.recentCustomers.find((c) => c.id === id)?.name;
  const n = `${faNum(orderLines(ctx, st).length)} قلم`;
  if (kindOf(st) === "sample") return [...(name ? [name] : []), "نمونهٔ رایگان", n];
  const total = orderTotal(ctx, st);
  const got = Number(st.values.collected ?? 0);
  return [
    ...(name ? [name] : []),
    n,
    `جمع ${faToman(total)}`,
    got >= total ? "نقد" : got > 0 ? `نقد ${faToman(got)}` : "نسیه",
  ];
}
