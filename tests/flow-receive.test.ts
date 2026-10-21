import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { receiveFlow, receiveRequest, receiveTotal, receiveChips } from "@/lib/flows/receive";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctx: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "receive",
  products: [{ id: 9, name: "شیر ۱ لیتری", price_toman: 45000 }, { id: 10, name: "ماست", price_toman: null }],
  items: [{ id: 1, label: "کارخانه مرحبا" }, { id: 2, label: "لبنیات سحر" }],
  vars: { today: "2026-10-21", product: "شیر ۱ لیتری", unit: "عدد" },
};

const walk = (c: FlowContext, extra: { supplier?: string; expiry?: string } = {}) => {
  let st = startFlow(receiveFlow, c);
  st = answerStep(receiveFlow, c, st, "pick", "9");
  st = answerStep(receiveFlow, c, st, "ok", "120");
  st = answerStep(receiveFlow, c, st, "ok", "47000");
  st = answerStep(receiveFlow, c, st, extra.supplier ?? "nosup");
  st = extra.expiry ? answerStep(receiveFlow, c, st, "ok", extra.expiry) : answerStep(receiveFlow, c, st, "none");
  return answerStep(receiveFlow, c, st, "ok");
};

describe("goods receiving flow", () => {
  it("meets the capture-flow budget with no dead ends", () => {
    assertFlowBudget(receiveFlow, [{ ctx, values: { qty: "1", cost: "1", expiry: "2027-01-01" } }], { common: 7, longest: 12 });
    assertNoRawEnumLabels(receiveFlow);
  });

  it("records a one-line purchase with quantity, cost, supplier and expiry", () => {
    const st = walk(ctx, { supplier: "s1", expiry: "2027-04-21" });
    expect(st.saved).toBe(true);
    expect(receiveRequest(ctx, st)).toEqual({
      supplier: "کارخانه مرحبا",
      purchase_date: "2026-10-21",
      invoice_no: null,
      lines: [{ product_id: 9, base_qty: 120, unit_cost_toman: 47000, expiry_date: "2027-04-21" }],
    });
  });

  it("no supplier and no expiry send null, not empty strings", () => {
    const st = walk(ctx);
    const r = receiveRequest(ctx, st);
    expect(r.supplier).toBeNull();
    expect(r.lines[0].expiry_date).toBeNull();
  });

  it("the total is quantity times unit cost, rounded to whole toman", () => {
    expect(receiveTotal(walk(ctx))).toBe(120 * 47000);
    let st = startFlow(receiveFlow, ctx);
    st = answerStep(receiveFlow, ctx, st, "pick", "9");
    st = answerStep(receiveFlow, ctx, st, "ok", "2.5");
    st = answerStep(receiveFlow, ctx, st, "ok", "1001");
    expect(receiveTotal(st)).toBe(2503);
  });

  it("asks for the quantity in the product's own unit", () => {
    let st = startFlow(receiveFlow, ctx);
    st = answerStep(receiveFlow, ctx, st, "pick", "9");
    expect(viewStep(receiveFlow, ctx, st).id).toBe("qty");
  });

  it("lists recent suppliers as answers and always allows «بدون تأمین‌کننده»", () => {
    let st = startFlow(receiveFlow, ctx);
    st = answerStep(receiveFlow, ctx, st, "pick", "9");
    st = answerStep(receiveFlow, ctx, st, "ok", "10");
    st = answerStep(receiveFlow, ctx, st, "ok", "100");
    const ids = viewStep(receiveFlow, ctx, st).options.map((o) => o.id);
    expect(ids).toEqual(["s1", "s2", "nosup"]);
  });

  it("the confirm line states the product, quantity, cost and total", () => {
    let st = startFlow(receiveFlow, ctx);
    st = answerStep(receiveFlow, ctx, st, "pick", "9");
    st = answerStep(receiveFlow, ctx, st, "ok", "120");
    st = answerStep(receiveFlow, ctx, st, "ok", "47000");
    st = answerStep(receiveFlow, ctx, st, "nosup");
    st = answerStep(receiveFlow, ctx, st, "none");
    const sub = viewStep(receiveFlow, ctx, st).sub ?? "";
    expect(sub).toContain("شیر ۱ لیتری");
    expect(sub).toContain("۱۲۰");
    expect(sub).toContain("۵٬۶۴۰٬۰۰۰");
  });

  it("the done screen lists every recorded fact", () => {
    const chips = receiveChips(ctx, walk(ctx, { supplier: "s2" })).join(" | ");
    for (const part of ["شیر ۱ لیتری", "۱۲۰", "لبنیات سحر", "۵٬۶۴۰٬۰۰۰"]) expect(chips).toContain(part);
  });
});
