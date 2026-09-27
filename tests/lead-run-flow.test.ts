import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowState } from "@/lib/crm/flows/types";
import { startFlow, viewStep, answerStep } from "@/lib/crm/flows/machine";
import { leadRunFlow } from "@/lib/crm/flows/leadRun";
import { checkFlow } from "@/lib/crm/flows/validate";

const ctx = { ...EMPTY_CONTEXT, entry: "add_lead" as const, isManager: true };

describe("lead-run assign flow", () => {
  it("has no dead ends and stays inside its budget", () => {
    const r = checkFlow(leadRunFlow, [{ ctx, values: {} }]);
    expect(r.deadEnds).toEqual([]);
    expect(r.shortest).toBeLessThanOrEqual(leadRunFlow.budget.common);
    expect(r.longest).toBeLessThanOrEqual(leadRunFlow.budget.longest);
  });

  /* The crash this flow actually shipped with: TapFlow reads the top of `state.stack` on
   * every render, and the host was handing it a literal `{ stack: [] }`, so `stepOf` looked
   * up `steps[undefined]`. Keep the trap named so nobody re-introduces a bare empty state. */
  it("cannot render an unseeded state", () => {
    const unseeded: FlowState = { stack: [], answers: [], acc: {}, values: {}, saved: false };
    expect(() => viewStep(leadRunFlow, ctx, unseeded)).toThrow(/unknown step undefined/);
  });

  it("seeds on the driver step, so the first paint has a question to show", () => {
    const st = startFlow(leadRunFlow, ctx);
    expect(st.stack).toEqual(["driver"]);
    expect(viewStep(leadRunFlow, ctx, st).id).toBe("driver");
  });

  it("walks driver -> date -> submit and saves on confirm", () => {
    let st = startFlow(leadRunFlow, ctx);
    st = answerStep(leadRunFlow, ctx, st, "next");
    expect(viewStep(leadRunFlow, ctx, st).id).toBe("date");
    st = answerStep(leadRunFlow, ctx, st, "next");
    expect(viewStep(leadRunFlow, ctx, st).id).toBe("submit");
    st = answerStep(leadRunFlow, ctx, st, "confirm");
    expect(st.saved).toBe(true);
  });

  /* Both pickers are host-rendered kinds: TapFlow must defer to `renderCustom` for them,
   * and that is what supplies each screen's "next" button. */
  it("hands the two picker steps to the host renderer", () => {
    const st = startFlow(leadRunFlow, ctx);
    expect(viewStep(leadRunFlow, ctx, st).kind).toBe("driver");
    const atDate = answerStep(leadRunFlow, ctx, st, "next");
    expect(viewStep(leadRunFlow, ctx, atDate).kind).toBe("date");
  });
});
