import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { deliveryFlow, deliveryPayload, deliveredTotal, deliveryChips, withTotals } from "@/lib/flows/delivery";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctx: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "delivery",
  vars: { customer: "نانوایی سنگک" },
  items: [
    { id: 11, label: "شیر ۱ لیتری", qty: 10, price: 60000 },
    { id: 12, label: "ماست", qty: 6, price: 100000 },
  ],
};

describe("delivery flow", () => {
  it("meets its tap budget with no dead ends", () => {
    assertFlowBudget(deliveryFlow, [{ ctx, values: { collected_amount: "500000" } }]);
    assertNoRawEnumLabels(deliveryFlow);
  });

  it("everything delivered + full cash is the 2-tap path", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "yes");
    st = answerStep(deliveryFlow, ctx, st, "full");
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(2);
    expect(deliveryPayload(ctx, st)).toEqual({
      lines: [{ line_id: 11, packs_delivered: 10 }, { line_id: 12, packs_delivered: 6 }],
      collected_toman: 1200000,
      notes: null,
    });
  });

  it("a short delivery records the counts, the reason and the typed amount", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "no");
    st = answerStep(deliveryFlow, ctx, st, "ok", JSON.stringify({ 11: 10, 12: 4 }));
    st = answerStep(deliveryFlow, ctx, st, "stock");
    st = answerStep(deliveryFlow, ctx, st, "other");
    st = answerStep(deliveryFlow, ctx, st, "ok", "500000"); // stored under values.collected_amount
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(5);
    expect(deliveryPayload(ctx, st)).toEqual({
      lines: [{ line_id: 11, packs_delivered: 10 }, { line_id: 12, packs_delivered: 4 }],
      collected_toman: 500000,
      notes: "موجودی کم بود",
    });
  });

  it("«کل مبلغ» after a shortfall means the DELIVERED total, not the ordered one", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "no");
    st = answerStep(deliveryFlow, ctx, st, "ok", JSON.stringify({ 11: 10, 12: 4 }));
    st = answerStep(deliveryFlow, ctx, st, "refused");
    expect(deliveredTotal(ctx, st)).toBe(1000000);
    expect(withTotals(ctx, st).vars.total_label).toContain("۱٬۰۰۰٬۰۰۰");
    st = answerStep(deliveryFlow, ctx, st, "full");
    expect(deliveryPayload(ctx, st).collected_toman).toBe(1000000);
  });

  it("collecting nothing sends 0, never the total", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "yes");
    st = answerStep(deliveryFlow, ctx, st, "none");
    expect(deliveryPayload(ctx, st).collected_toman).toBe(0);
  });

  it("the cash question shows the delivered total when the host passes withTotals(ctx, state)", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "no");
    st = answerStep(deliveryFlow, ctx, st, "ok", JSON.stringify({ 11: 5, 12: 6 }));
    st = answerStep(deliveryFlow, ctx, st, "damaged");
    const view = viewStep(deliveryFlow, withTotals(ctx, st), st);
    expect(view.id).toBe("cash");
    expect(view.options.find((o) => o.id === "full")?.sub).toContain("۹۰۰٬۰۰۰");
  });

  it("the done screen lists what was recorded", () => {
    let st = startFlow(deliveryFlow, ctx);
    st = answerStep(deliveryFlow, ctx, st, "yes");
    st = answerStep(deliveryFlow, ctx, st, "none");
    const chips = deliveryChips(ctx, st);
    expect(chips).toContain("تحویل کامل");
    expect(chips.join(" ")).toContain("دریافتی: ۰");
  });
});

describe("delivery failure copy", () => {
  it("the 'saved on the phone' message survives friendlyError unchanged", async () => {
    const { friendlyError } = await import("@/lib/userMessage");
    const m = "تحویل هنوز ارسال نشد، اما روی گوشی ذخیره است و با وصل شدن اینترنت خودکار ارسال می‌شود.";
    expect(friendlyError(m, "x")).toBe(m);
  });
});
