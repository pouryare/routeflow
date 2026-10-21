import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import {
  complaintFlow, complaintPayload, complaintChips, CATEGORY_LABEL, SEVERITY_LABEL,
} from "@/lib/flows/complaint";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const base: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "complaint",
  recentCustomers: [{ id: 5, name: "بقالی رضا" }, { id: 6, name: "نانوایی سنگک" }],
  products: [{ id: 9, name: "شیر ۱ لیتری", price_toman: null }, { id: 10, name: "ماست", price_toman: null }],
};
const withCustomer: FlowContext = { ...base, vars: { customer_id: "5", customer: "بقالی رضا" } };
const fromOrder: FlowContext = { ...withCustomer, vars: { ...withCustomer.vars, order_id: "42" } };

describe("complaint flow", () => {
  it("meets its tap budget with no dead ends, whatever the screen already knows", () => {
    assertFlowBudget(complaintFlow, [
      { ctx: base, values: { who: "5", what: "9" } },
      { ctx: withCustomer, values: { what: "9" } },
      { ctx: { ...withCustomer, vars: { ...withCustomer.vars, product_id: "9" } }, values: {} },
    ]);
    assertNoRawEnumLabels(complaintFlow);
  });

  it("walks customer, product, kind, severity and an optional note", () => {
    let st = startFlow(complaintFlow, base);
    expect(viewStep(complaintFlow, base, st).id).toBe("who");
    st = answerStep(complaintFlow, base, st, "pick", "5");
    st = answerStep(complaintFlow, base, st, "pick", "9");
    st = answerStep(complaintFlow, base, st, "spoilage");
    st = answerStep(complaintFlow, base, st, "high");
    st = answerStep(complaintFlow, base, st, "ok", "بوی بد می‌داد");
    expect(st.saved).toBe(true);
    expect(complaintPayload(base, st)).toEqual({
      customer_id: 5, order_id: null, product_id: 9, batch_id: null,
      category: "spoilage", severity: "high", description: "بوی بد می‌داد",
    });
  });

  it("the note is optional and an empty note sends null", () => {
    let st = startFlow(complaintFlow, withCustomer);
    st = answerStep(complaintFlow, withCustomer, st, "pick", "10");
    st = answerStep(complaintFlow, withCustomer, st, "packaging");
    st = answerStep(complaintFlow, withCustomer, st, "medium");
    st = answerStep(complaintFlow, withCustomer, st, "ok");
    expect(complaintPayload(withCustomer, st).description).toBeNull();
  });

  it("«کالا مشخص نیست» records no product rather than a guess", () => {
    let st = startFlow(complaintFlow, withCustomer);
    st = answerStep(complaintFlow, withCustomer, st, "unknown");
    st = answerStep(complaintFlow, withCustomer, st, "other");
    st = answerStep(complaintFlow, withCustomer, st, "low");
    st = answerStep(complaintFlow, withCustomer, st, "ok");
    expect(complaintPayload(withCustomer, st).product_id).toBeNull();
    expect(complaintChips(withCustomer, st)).toContain("کالا: مشخص نیست");
  });

  it("opened from an order, the order id travels with the complaint so the batch can be found", () => {
    let st = startFlow(complaintFlow, fromOrder);
    st = answerStep(complaintFlow, fromOrder, st, "pick", "9");
    st = answerStep(complaintFlow, fromOrder, st, "foreign_object");
    st = answerStep(complaintFlow, fromOrder, st, "critical");
    st = answerStep(complaintFlow, fromOrder, st, "ok");
    expect(complaintPayload(fromOrder, st)).toMatchObject({ order_id: 42, product_id: 9, customer_id: 5 });
  });

  it("a screen that knows the product skips that question", () => {
    const known = { ...withCustomer, vars: { ...withCustomer.vars, product_id: "9" } };
    expect(viewStep(complaintFlow, known, startFlow(complaintFlow, known)).id).toBe("kind");
  });

  it("severity highlights «متوسط» as the suggestion but pre-selects nothing", () => {
    let st = startFlow(complaintFlow, withCustomer);
    st = answerStep(complaintFlow, withCustomer, st, "unknown");
    st = answerStep(complaintFlow, withCustomer, st, "other");
    const v = viewStep(complaintFlow, withCustomer, st);
    expect(v.id).toBe("severity");
    expect(v.options.find((o) => o.tone === "rec")?.id).toBe("medium");
    expect(st.values.severity).toBeUndefined();
  });

  it("every category and severity the server accepts has a Persian label", () => {
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual(["foreign_object", "other", "packaging", "short_weight", "spoilage", "wrong_product"]);
    expect(Object.keys(SEVERITY_LABEL).sort()).toEqual(["critical", "high", "low", "medium"]);
  });

  it("the done screen lists customer, product, kind and severity", () => {
    let st = startFlow(complaintFlow, base);
    st = answerStep(complaintFlow, base, st, "pick", "6");
    st = answerStep(complaintFlow, base, st, "pick", "10");
    st = answerStep(complaintFlow, base, st, "short_weight");
    st = answerStep(complaintFlow, base, st, "medium");
    st = answerStep(complaintFlow, base, st, "ok", "کمتر از وزن");
    const chips = complaintChips(base, st).join(" | ");
    for (const part of ["نانوایی سنگک", "ماست", CATEGORY_LABEL.short_weight, SEVERITY_LABEL.medium]) expect(chips).toContain(part);
  });
});
