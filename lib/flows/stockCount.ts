import type { FlowConfig, FlowContext, FlowOption, FlowState } from "@/lib/crm/flows/types";
import type { MovementKind } from "@/lib/repo/stock";
import { faNum } from "@/lib/format";

/** Counting one product on the shelf.
 *
 *  The system says how many there should be at THIS facility; the person says «درست است» (one
 *  tap, nothing is written) or gives the number and says why it differs. The reason decides the
 *  movement kind, so reports can tell breakage from expiry from samples from plain loss. Every
 *  correction is a new signed movement (the ledger is append-only); nothing is ever edited.
 *
 *  A host loops this over the products, one flow instance per product.
 *
 *  Contract with `countMovement`: vars.product_id / facility_id / expected / product / facility;
 *  values.count (the counted number), values.kind + values.why (put by the reason chips),
 *  values.match = "1" when nothing is to be written. */
export const round3 = (n: number): number => Math.round(n * 1000) / 1000;
export const countDiff = (counted: number, expected: number): number => round3(counted - expected);

const SHORT: { id: string; label: string; kind: MovementKind }[] = [
  { id: "damaged", label: "خراب شده", kind: "WRITE_OFF" },
  { id: "expired", label: "تاریخ مصرف گذشته", kind: "WRITE_OFF" },
  { id: "sample", label: "نمونه داده شد", kind: "SAMPLE_OUT" },
  { id: "lost", label: "نامعلوم", kind: "COUNT" },
];
const OVER: { id: string; label: string; kind: MovementKind }[] = [
  { id: "unlogged", label: "خرید یا دریافت ثبت‌نشده", kind: "ADJUSTMENT" },
  { id: "miscount", label: "شمارش قبلی اشتباه بود", kind: "COUNT" },
];

const expected = (ctx: FlowContext): number => Number(ctx.vars.expected ?? 0);

export const stockCountFlow: FlowConfig = {
  id: "stock_count",
  start: () => "check",
  budget: { common: 1, longest: 3 },
  steps: {
    check: {
      id: "check",
      kind: "choice",
      q: "موجودی «{product}» درست است؟",
      sub: "سیستم می‌گوید {expected_label} در {facility}",
      options: [
        { id: "ok", label: "درست است", tone: "rec", save: true, put: { match: "1" } },
        { id: "diff", label: "فرق دارد", sub: "عدد شمارش‌شده را وارد می‌کنید", next: "count" },
        { id: "empty", label: "چیزی نمانده", sub: "موجودی صفر است", next: "why", put: { count: "0" } },
        { id: "later", label: "بعداً می‌شمارم", save: true, put: { match: "1", skipped: "1" } },
      ],
    },
    count: {
      id: "count",
      kind: "amount",
      q: "چند عدد شمردید؟",
      input: { field: "count", placeholder: "تعداد شمارش‌شده", decimal: true, allowZero: true },
      options: [{ id: "ok", label: "ادامه", tone: "rec", next: "why" }],
    },
    why: {
      id: "why",
      kind: "choice",
      q: "فرق از کجاست؟",
      sub: "{diff_line}",
      options: (ctx, s): FlowOption[] => {
        const diff = countDiff(Number(s.values.count ?? 0), expected(ctx));
        if (diff === 0) return [{ id: "nodiff", label: "تفاوتی نیست", tone: "rec", save: true, put: { match: "1" } }];
        const set = diff < 0 ? SHORT : OVER;
        return set.map((r) => ({ id: r.id, label: r.label, save: true, put: { kind: r.kind, why: r.label } }));
      },
    },
  },
};

/** True when this answer records nothing: confirmed as is, skipped, or counted equal. */
export const countWritesNothing = (st: Pick<FlowState, "values">): boolean => st.values.match === "1";

/** The movement to record, or null. The body POST /api/sales/stock/movements expects (the
 *  server fills `occurred_at` and the author). `base_qty` is the signed difference. */
export function countMovement(ctx: FlowContext, st: Pick<FlowState, "values">) {
  if (countWritesNothing(st)) return null;
  return {
    facility_id: Number(ctx.vars.facility_id),
    product_id: Number(ctx.vars.product_id),
    batch_id: null,
    base_qty: countDiff(Number(st.values.count), expected(ctx)),
    kind: st.values.kind as MovementKind,
    notes: `شمارش انبار · ${st.values.why}`,
  };
}

/** What the done line and the toast say. */
export function countChips(ctx: FlowContext, st: Pick<FlowState, "values">): string[] {
  const name = ctx.vars.product;
  if (st.values.skipped === "1") return [name, "شمرده نشد"];
  if (countWritesNothing(st)) return [name, "درست بود"];
  const diff = countDiff(Number(st.values.count), expected(ctx));
  return [
    name,
    `شمارش: ${faNum(Number(st.values.count), { maximumFractionDigits: 2 })} ${ctx.vars.unit ?? ""}`.trim(),
    `فرق: ${diff > 0 ? "+" : ""}${faNum(diff, { maximumFractionDigits: 2 })}`,
    st.values.why,
  ];
}
