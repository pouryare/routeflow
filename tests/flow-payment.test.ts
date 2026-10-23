import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { paymentFlow, paymentRequest, paymentChips, METHOD_LABEL } from "@/lib/flows/payment";
import { checkFlow } from "@/lib/crm/flows/validate";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const base: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "payment",
  vars: { received_at: "2026-10-21" },
  recentCustomers: [{ id: 5, name: "بقالی رضا (C-5)" }, { id: 6, name: "نانوایی سنگک (C-6)" }],
};
const known: FlowContext = { ...base, vars: { ...base.vars, customer_id: "5", amount: "800000" } };

describe("payment flow", () => {
  it("meets its tap budget with no dead ends, from a customer screen and from the list", () => {
    assertFlowBudget(paymentFlow, [
      { ctx: known, values: { amount: "1", cheque_no: "1", due: "2026-12-01" } },
      { ctx: base, values: { who: "5", amount: "1", cheque_no: "1", due: "2026-12-01" } },
    ]);
    assertNoRawEnumLabels(paymentFlow);
  });

  it("cash for a known customer is 2 taps and posts to /api/payments", () => {
    let st = startFlow(paymentFlow, known);
    expect(viewStep(paymentFlow, known, st).id).toBe("method");
    st = answerStep(paymentFlow, known, st, "CASH");
    st = answerStep(paymentFlow, known, st, "ok", "800000");
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(2);
    expect(paymentRequest(known, st)).toEqual({
      url: "/api/payments",
      body: { customer_id: 5, amount_toman: 800000, method: "CASH", received_at: "2026-10-21", reference: null, note: null },
    });
  });

  it("asks who first when no customer is known, and posts for that customer", () => {
    let st = startFlow(paymentFlow, base);
    expect(viewStep(paymentFlow, base, st).id).toBe("who");
    st = answerStep(paymentFlow, base, st, "pick", "6");
    st = answerStep(paymentFlow, base, st, "CASH");
    st = answerStep(paymentFlow, base, st, "ok", "100000");
    expect(paymentRequest(base, st).body).toMatchObject({ customer_id: 6, amount_toman: 100000 });
  });

  it("a card payment may carry the tracking number, and may leave it out", () => {
    let st = startFlow(paymentFlow, known);
    st = answerStep(paymentFlow, known, st, "POS");
    expect(viewStep(paymentFlow, known, st).id).toBe("ref");
    st = answerStep(paymentFlow, known, st, "ok", "9876");
    st = answerStep(paymentFlow, known, st, "ok", "250000");
    expect(paymentRequest(known, st).body).toMatchObject({ method: "POS", reference: "9876" });

    let st2 = startFlow(paymentFlow, known);
    st2 = answerStep(paymentFlow, known, st2, "CARD_TO_CARD");
    st2 = answerStep(paymentFlow, known, st2, "ok"); // no tracking number typed
    st2 = answerStep(paymentFlow, known, st2, "ok", "250000");
    expect(paymentRequest(known, st2).body).toMatchObject({ method: "CARD_TO_CARD", reference: null });
  });

  it("a cheque goes to /api/cheques with number, bank, due date and amount", () => {
    let st = startFlow(paymentFlow, known);
    st = answerStep(paymentFlow, known, st, "CHEQUE");
    expect(viewStep(paymentFlow, known, st).id).toBe("cheque_no");
    st = answerStep(paymentFlow, known, st, "ok", "123456");
    st = answerStep(paymentFlow, known, st, "melli");
    st = answerStep(paymentFlow, known, st, "ok", "2026-12-01");
    st = answerStep(paymentFlow, known, st, "ok", "800000");
    expect(st.saved).toBe(true);
    expect(paymentRequest(known, st)).toEqual({
      url: "/api/cheques",
      body: { customer_id: 5, amount_toman: 800000, cheque_no: "123456", bank_name: "ملی", due_date: "2026-12-01", received_at: "2026-10-21" },
    });
  });

  it("«سایر بانک» leaves the bank empty rather than inventing one", () => {
    let st = startFlow(paymentFlow, known);
    st = answerStep(paymentFlow, known, st, "CHEQUE");
    st = answerStep(paymentFlow, known, st, "ok", "1");
    st = answerStep(paymentFlow, known, st, "other_bank");
    st = answerStep(paymentFlow, known, st, "ok", "2026-12-01");
    st = answerStep(paymentFlow, known, st, "ok", "5");
    expect(paymentRequest(known, st).body).toMatchObject({ bank_name: null });
  });

  it("the cheque number is required", () => {
    let st = startFlow(paymentFlow, known);
    st = answerStep(paymentFlow, known, st, "CHEQUE");
    expect(() => answerStep(paymentFlow, known, st, "ok")).toThrow();
  });

  it("the done screen lists customer, method, amount and the date used", () => {
    let st = startFlow(paymentFlow, known);
    st = answerStep(paymentFlow, known, st, "CASH");
    st = answerStep(paymentFlow, known, st, "ok", "800000");
    const chips = paymentChips(known, st).join(" | ");
    expect(chips).toContain("بقالی رضا");
    expect(chips).toContain(METHOD_LABEL.CASH);
    expect(chips).toContain("۸۰۰٬۰۰۰");
    expect(chips).toContain("تاریخ");
    expect(chips).toContain("به حروف: هشتصد هزار تومان");
  });

  it("offers no 'credit note' (that is created by the system, not collected at a door)", () => {
    const labels = (viewStep(paymentFlow, known, startFlow(paymentFlow, known)).options).map((o) => o.id);
    expect(labels).not.toContain("CREDIT_NOTE");
  });
});

describe("a screen that only deals with cheques", () => {
  const chq: FlowContext = { ...known, vars: { ...known.vars, method: "CHEQUE" } };
  it("skips the method question when the customer is known", () => {
    const st = startFlow(paymentFlow, chq);
    expect(viewStep(paymentFlow, chq, st).id).toBe("cheque_no");
  });
  it("asks who first, then goes straight to the cheque number", () => {
    const noCustomer: FlowContext = { ...base, vars: { ...base.vars, method: "CHEQUE" } };
    let st = startFlow(paymentFlow, noCustomer);
    st = answerStep(paymentFlow, noCustomer, st, "pick", "6");
    expect(viewStep(paymentFlow, noCustomer, st).id).toBe("cheque_no");
    st = answerStep(paymentFlow, noCustomer, st, "ok", "77");
    st = answerStep(paymentFlow, noCustomer, st, "tejarat");
    st = answerStep(paymentFlow, noCustomer, st, "ok", "2026-11-30");
    st = answerStep(paymentFlow, noCustomer, st, "ok", "1000");
    expect(paymentRequest(noCustomer, st)).toMatchObject({ url: "/api/cheques", body: { customer_id: 6, cheque_no: "77", bank_name: "تجارت" } });
  });
  it("is 4 taps from the cheques board with a known customer", () => {
    const r = checkFlow(paymentFlow, [{ ctx: chq, values: { cheque_no: "1", due: "2026-12-01", amount: "1" } }]);
    expect(r.deadEnds).toEqual([]);
    expect(r.shortest).toBe(4);
    expect(r.longest).toBe(4);
  });
});
