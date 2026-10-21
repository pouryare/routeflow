import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { outcomeFlow, outcomeCode, outcomeChips, TASK_OUTCOME_LABEL } from "@/lib/flows/outcome";
import { OUTCOME_LABEL } from "@/lib/tasks/labels";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const plain: FlowContext = { ...EMPTY_CONTEXT, entry: "outcome", vars: { task: "پیگیری قیمت" } };
const board: FlowContext = { ...plain, vars: { ...plain.vars, allow_none: "1" } };

describe("task outcome flow", () => {
  it("is one question and one tap, with and without «بدون نتیجه»", () => {
    assertFlowBudget(outcomeFlow, [{ ctx: plain, values: {} }, { ctx: board, values: {} }]);
    assertNoRawEnumLabels(outcomeFlow);
  });

  it("each outcome saves on the first tap with its code", () => {
    for (const code of Object.keys(TASK_OUTCOME_LABEL)) {
      const st = answerStep(outcomeFlow, plain, startFlow(outcomeFlow, plain), code);
      expect(st.saved).toBe(true);
      expect(outcomeCode(st)).toBe(code);
    }
  });

  it("uses only codes the app already knows, so objection cards and reports still match", () => {
    for (const code of Object.keys(TASK_OUTCOME_LABEL)) expect(OUTCOME_LABEL[code]).toBeDefined();
  });

  it("«بدون نتیجه» exists only where the screen allows it, and sends no code", () => {
    const ids = (c: FlowContext) => viewStep(outcomeFlow, c, startFlow(outcomeFlow, c)).options.map((o) => o.id);
    expect(ids(plain)).not.toContain("none");
    expect(ids(board)).toContain("none");
    const st = answerStep(outcomeFlow, board, startFlow(outcomeFlow, board), "none");
    expect(outcomeCode(st)).toBeNull();
    expect(outcomeChips(st)).toEqual(["بدون نتیجه"]);
  });

  it("names the task being closed", () => {
    expect(viewStep(outcomeFlow, plain, startFlow(outcomeFlow, plain)).sub).toBe("پیگیری قیمت");
  });
});
