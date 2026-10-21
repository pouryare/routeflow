import type { FlowConfig, FlowContext, FlowState } from "@/lib/crm/flows/types";
import type { ComplaintCategory, ComplaintSeverity } from "@/lib/repo/complaints";

/* The words for what the server accepts. Typed as Records over the server's unions, so adding a
   category or severity there is a compile error here until it has a Persian label -- and the
   desk panel imports these instead of keeping a second copy. */
export const CATEGORY_LABEL: Record<ComplaintCategory, string> = {
  spoilage: "فساد",
  packaging: "بسته‌بندی",
  foreign_object: "جسم خارجی",
  short_weight: "کسری وزن",
  wrong_product: "کالای اشتباه",
  other: "سایر",
};
export const SEVERITY_LABEL: Record<ComplaintSeverity, string> = {
  low: "کم",
  medium: "متوسط",
  high: "زیاد",
  critical: "بحرانی",
};

/** A quality complaint, filed where it is heard: on the phone with the customer, or beside the
 *  order it is about.
 *
 *  The screen can fix what the flow would otherwise ask: `vars.customer_id` skips «who»,
 *  `vars.product_id` skips «what», and `vars.order_id` is carried to the server, which uses
 *  order + product to find the batch the goods came from (that is how a cluster of complaints
 *  on one batch gets noticed).
 *
 *  Keys the steps store under, the contract with `complaintPayload`:
 *    who / what   the picked customer / product id (a `pick` step stores under its step id)
 *    category, severity   `put` from the chips
 *    description  the optional note
 *
 *  There is no photo step: the complaints table has no place to keep one. */
const afterWho = (ctx: FlowContext): string => (ctx.vars.product_id ? "kind" : "what");

export const complaintFlow: FlowConfig = {
  id: "complaint",
  start: (ctx) => (ctx.vars.customer_id ? afterWho(ctx) : "who"),
  budget: { common: 5, longest: 5 },
  steps: {
    who: {
      id: "who",
      kind: "pick",
      q: "شکایت از طرف کدام مشتری است؟",
      choices: (ctx) => ctx.recentCustomers.map((c) => ({ id: String(c.id), label: c.name })),
      options: [{ id: "pick", label: "ادامه", next: (ctx) => afterWho(ctx) }],
    },
    what: {
      id: "what",
      kind: "pick",
      q: "دربارهٔ کدام کالا؟",
      sub: "{customer}",
      choices: (ctx) => ctx.products.map((p) => ({ id: String(p.id), label: p.name })),
      options: [
        { id: "pick", label: "ادامه", next: "kind" },
        { id: "unknown", label: "کالا مشخص نیست", next: "kind" },
      ],
    },
    kind: {
      id: "kind",
      kind: "choice",
      q: "مشکل چیست؟",
      options: (Object.keys(CATEGORY_LABEL) as ComplaintCategory[]).map((id) => ({
        id,
        label: CATEGORY_LABEL[id],
        next: "severity",
        put: { category: id },
      })),
    },
    severity: {
      id: "severity",
      kind: "choice",
      q: "چقدر جدی است؟",
      options: (Object.keys(SEVERITY_LABEL) as ComplaintSeverity[]).map((id) => ({
        id,
        label: SEVERITY_LABEL[id],
        tone: id === "medium" ? ("rec" as const) : undefined,
        next: "note",
        put: { severity: id },
      })),
    },
    note: {
      id: "note",
      kind: "input",
      q: "توضیح دیگری هست؟",
      sub: "اختیاری",
      input: { field: "description", placeholder: "توضیح (اختیاری)", optional: true },
      options: [{ id: "ok", label: "ثبت شکایت", tone: "rec", save: true }],
    },
  },
};

const num = (v: string | undefined): number | null => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** The exact body POST /api/sales/complaints expects. `batch_id` is left to the server. */
export function complaintPayload(ctx: FlowContext, st: FlowState) {
  return {
    customer_id: num(ctx.vars.customer_id ?? st.values.who),
    order_id: num(ctx.vars.order_id),
    product_id: num(ctx.vars.product_id ?? st.values.what),
    batch_id: null,
    category: st.values.category,
    severity: st.values.severity,
    description: st.values.description?.trim() ? st.values.description.trim() : null,
  };
}

/** Every recorded fact for the done screen. */
export function complaintChips(ctx: FlowContext, st: FlowState): string[] {
  const p = complaintPayload(ctx, st);
  const customer = ctx.vars.customer ?? ctx.recentCustomers.find((c) => c.id === p.customer_id)?.name;
  const product = ctx.products.find((x) => x.id === p.product_id)?.name;
  return [
    ...(customer ? [customer] : []),
    product ? `کالا: ${product}` : "کالا: مشخص نیست",
    CATEGORY_LABEL[st.values.category as ComplaintCategory] ?? st.values.category,
    `شدت: ${SEVERITY_LABEL[st.values.severity as ComplaintSeverity] ?? st.values.severity}`,
    ...(p.description ? ["توضیح ثبت شد"] : []),
  ];
}
