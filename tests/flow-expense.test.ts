import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep } from "@/lib/crm/flows/machine";
import { expenseFlow, expenseRequest, expenseChips, EXPENSE_METHODS, hasPhoto } from "@/lib/flows/expense";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctx: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "expense",
  lists: {
    category: [{ id: 41, label: "سوخت" }, { id: 42, label: "اجاره" }],
    supplier: [{ id: 1, label: "پمپ بنزین مرکزی" }],
  },
  vars: { today: "2026-10-21" },
};

const walk = (supplier = "nosup", method = "CASH", photo = "none") => {
  let st = startFlow(expenseFlow, ctx);
  st = answerStep(expenseFlow, ctx, st, "pick", "41");
  st = answerStep(expenseFlow, ctx, st, "ok", "350000");
  st = answerStep(expenseFlow, ctx, st, supplier);
  st = answerStep(expenseFlow, ctx, st, method);
  return answerStep(expenseFlow, ctx, st, photo);
};

describe("expense flow", () => {
  it("meets its tap budget with no dead ends", () => {
    assertFlowBudget(expenseFlow, [{ ctx, values: { category: "41", amount: "1" } }]);
    assertNoRawEnumLabels(expenseFlow);
  });

  it("is five taps (the last is the optional receipt photo), saved on the last, and posts today's date", () => {
    const st = walk("s1", "POS");
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(5);
    expect(expenseRequest(ctx, st)).toEqual({
      account_id: 41,
      amount_toman: 350000,
      method: "POS",
      incurred_at: "2026-10-21",
      memo: "پرداخت به پمپ بنزین مرکزی",
    });
  });

  it("no supplier means no memo", () => {
    expect(expenseRequest(ctx, walk()).memo).toBeNull();
  });

  it("an amount of zero is not an answer (the step does not allow it)", () => {
    expect(expenseFlow.steps.amount.input?.allowZero).toBeFalsy();
  });

  it("offers only methods the ledger can post to a cash or bank account", () => {
    expect([...EXPENSE_METHODS]).toEqual(["CASH", "POS", "CARD_TO_CARD"]);
  });

  it("names every fact on the done screen", () => {
    expect(expenseChips(ctx, walk("s1", "CARD_TO_CARD"))).toEqual(["سوخت", "۳۵۰٬۰۰۰ تومان", "پمپ بنزین مرکزی", "کارت به کارت"]);
  });

  it("taking a receipt photo is remembered (the host uploads it after saving) and shown on the done screen", () => {
    const st = walk("nosup", "CASH", "take");
    expect(st.saved).toBe(true);
    expect(hasPhoto(st)).toBe(true);
    expect(expenseChips(ctx, st)).toContain("با عکس رسید");
    expect(hasPhoto(walk())).toBe(false);
  });
});
