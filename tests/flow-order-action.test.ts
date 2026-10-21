import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { ORDER_TRANSITIONS, type OrderAction } from "@/lib/orderStateMachine";
import {
  orderActionFlow, actionBody, actionSummary, needsReason, REASON_DOMAIN, ACTION_LABEL,
} from "@/lib/flows/orderAction";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctx: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "order_action",
  vars: { action: "cancel", action_label: "لغو سفارش", reasons: "ready" },
  items: [{ id: 3, label: "مشتری منصرف شد" }, { id: 4, label: "قیمت اشتباه بود" }],
};

describe("order action flow", () => {
  it("is one question, one tap", () => {
    assertFlowBudget(orderActionFlow, [{ ctx, values: {} }]);
    assertNoRawEnumLabels(orderActionFlow);
  });

  it("each reason saves on the tap and travels as a reason_code_id", () => {
    const st = answerStep(orderActionFlow, ctx, startFlow(orderActionFlow, ctx), "r4");
    expect(st.saved).toBe(true);
    expect(actionBody("cancel", st)).toEqual({ action: "cancel", reason_code_id: 4, note: null });
    expect(actionSummary("cancel", st)).toBe("لغو سفارش ثبت شد · قیمت اشتباه بود");
  });

  it("«دلیل مشخص نیست» is allowed and sends no reason", () => {
    const st = answerStep(orderActionFlow, ctx, startFlow(orderActionFlow, ctx), "none");
    expect(actionBody("cancel", st).reason_code_id).toBeNull();
    expect(actionSummary("cancel", st)).toBe("لغو سفارش ثبت شد");
  });

  it("reasons are tinted as the terminal answers they are", () => {
    const v = viewStep(orderActionFlow, ctx, startFlow(orderActionFlow, ctx));
    expect(v.options.filter((o) => o.id.startsWith("r")).every((o) => o.tone === "bad")).toBe(true);
  });

  it("while the reasons load, nothing can be saved by mistake", () => {
    const loading = { ...ctx, items: [], vars: { ...ctx.vars, reasons: "loading" } };
    expect(viewStep(orderActionFlow, loading, startFlow(orderActionFlow, loading)).options.map((o) => o.id)).toEqual(["wait"]);
  });

  it("an organisation with no reason codes still gets the honest answer", () => {
    const none = { ...ctx, items: [] };
    expect(viewStep(orderActionFlow, none, startFlow(orderActionFlow, none)).options.map((o) => o.id)).toEqual(["none"]);
  });
});

describe("which actions ask why", () => {
  it("exactly cancel, return and failed delivery", () => {
    expect(Object.keys(REASON_DOMAIN).sort()).toEqual(["cancel", "failDelivery", "returnOrder"]);
    expect(needsReason("cancel")).toBe(true);
    expect(needsReason("deliver")).toBe(false);
  });

  it("every action the state machine can fire has a label (the panel never prints a code)", () => {
    const actions = new Set<OrderAction>(ORDER_TRANSITIONS.map((t) => t.action));
    for (const a of actions) expect(ACTION_LABEL[a]).toBeTruthy();
  });
});

import { needsAsk, CONFIRM_ONLY, CONSEQUENCE } from "@/lib/flows/orderAction";

describe("credit rejection asks once", () => {
  const sure: FlowContext = { ...EMPTY_CONTEXT, entry: "order_action", vars: { action: "rejectCredit", action_label: "رد اعتبار", consequence: CONSEQUENCE.rejectCredit!, mode: "confirm", reasons: "ready" } };
  it("opens on «are you sure», says what will happen, and saves on yes", () => {
    expect(CONFIRM_ONLY).toEqual(["rejectCredit"]);
    expect(needsAsk("rejectCredit")).toBe(true);
    const v = viewStep(orderActionFlow, sure, startFlow(orderActionFlow, sure));
    expect(v.id).toBe("sure");
    expect(v.sub).toBe("سفارش متوقف می‌شود.");
    expect(v.options[0].tone).toBe("bad");
    const st = answerStep(orderActionFlow, sure, startFlow(orderActionFlow, sure), "yes");
    expect(st.saved).toBe(true);
    expect(actionBody("rejectCredit", st)).toEqual({ action: "rejectCredit", reason_code_id: null, note: null });
  });
  it("a plain forward step does not ask", () => {
    expect(needsAsk("deliver")).toBe(false);
    expect(needsAsk("passReview")).toBe(false);
  });
});
