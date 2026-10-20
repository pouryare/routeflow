import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowConfig } from "@/lib/crm/flows/types";
import { answerStep, backStep, startFlow, viewStep } from "@/lib/crm/flows/machine";

/* Undo in useFlowHost is `backStep` on the saved state: the sheet must reopen on the LAST
   question with every earlier answer kept, and a new tap must save again. */
const cfg: FlowConfig = {
  id: "u", start: () => "a", budget: { common: 2, longest: 2 },
  steps: {
    a: { id: "a", kind: "choice", q: "اول", options: [{ id: "x", label: "ایکس", next: "b", put: { first: "x" } }] },
    b: { id: "b", kind: "choice", q: "دوم", options: [{ id: "y", label: "وای", save: true, put: { second: "y" } }] },
  },
};

describe("undo reopens the last question", () => {
  it("backStep on a saved state returns to the final step with earlier answers kept", () => {
    let st = startFlow(cfg, EMPTY_CONTEXT);
    st = answerStep(cfg, EMPTY_CONTEXT, st, "x");
    st = answerStep(cfg, EMPTY_CONTEXT, st, "y");
    expect(st.saved).toBe(true);

    const reopened = backStep(cfg, EMPTY_CONTEXT, st);
    expect(reopened.saved).toBe(false);
    expect(viewStep(cfg, EMPTY_CONTEXT, reopened).id).toBe("b");
    expect(reopened.values.first).toBe("x");
    expect(reopened.values.second).toBeUndefined();
    expect(answerStep(cfg, EMPTY_CONTEXT, reopened, "y").saved).toBe(true);
  });
});
