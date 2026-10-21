import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { checkFlow } from "@/lib/crm/flows/validate";
import { LIFECYCLE_TRANSITIONS } from "@/lib/customerLifecycle";
import { LIFECYCLE_LABEL, type CustomerLifecycle } from "@/lib/types";
import { lifecycleFlow, lifecycleTarget, lifecycleChips, DESTRUCTIVE } from "@/lib/flows/lifecycle";
import { assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctxFor = (from: CustomerLifecycle): FlowContext => ({
  ...EMPTY_CONTEXT, entry: "lifecycle", vars: { from, customer: "بقالی رضا" },
});
const FROMS = Object.keys(LIFECYCLE_TRANSITIONS) as CustomerLifecycle[];

describe("customer lifecycle flow", () => {
  it("offers exactly the moves the transition table allows, for every state", () => {
    for (const from of FROMS) {
      const c = ctxFor(from);
      const ids = viewStep(lifecycleFlow, c, startFlow(lifecycleFlow, c)).options.map((o) => o.id);
      expect([...ids].sort()).toEqual([...LIFECYCLE_TRANSITIONS[from]].sort());
    }
  });

  it("labels come from the shared lifecycle words, never the raw code", () => {
    for (const from of FROMS) {
      const c = ctxFor(from);
      const v = viewStep(lifecycleFlow, c, startFlow(lifecycleFlow, c));
      for (const o of v.options) expect(o.label).toBe(LIFECYCLE_LABEL[o.id as CustomerLifecycle]);
    }
    assertNoRawEnumLabels(lifecycleFlow);
  });

  it("a safe move is one tap", () => {
    const c = ctxFor("lead");
    const st = answerStep(lifecycleFlow, c, startFlow(lifecycleFlow, c), "qualified");
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(1);
    expect(lifecycleTarget(st)).toBe("qualified");
  });

  it("every ending move is tinted and asks once, offering the gentler alternative", () => {
    for (const to of DESTRUCTIVE) {
      const from = FROMS.find((f) => LIFECYCLE_TRANSITIONS[f].includes(to) && LIFECYCLE_TRANSITIONS[f].includes("dormant"))!;
      const c = ctxFor(from);
      const first = viewStep(lifecycleFlow, c, startFlow(lifecycleFlow, c));
      expect(first.options.find((o) => o.id === to)?.tone).toBe("bad");
      let st = answerStep(lifecycleFlow, c, startFlow(lifecycleFlow, c), to);
      expect(st.saved).toBe(false);
      const sure = viewStep(lifecycleFlow, c, st);
      expect(sure.id).toBe("sure");
      expect(sure.options.map((o) => o.id)).toEqual(["yes", "gentler"]);
      st = answerStep(lifecycleFlow, c, st, "gentler");
      expect(lifecycleTarget(st)).toBe("dormant");
    }
  });

  it("confirming an ending move sends that move", () => {
    const c = ctxFor("active");
    let st = answerStep(lifecycleFlow, c, startFlow(lifecycleFlow, c), "lost");
    st = answerStep(lifecycleFlow, c, st, "yes");
    expect(st.saved).toBe(true);
    expect(lifecycleTarget(st)).toBe("lost");
  });

  it("when there is no gentler move, the second question has only the confirmation", () => {
    const c = ctxFor("lost"); // lost can only go to lead or blocked
    const st = answerStep(lifecycleFlow, c, startFlow(lifecycleFlow, c), "blocked");
    expect(viewStep(lifecycleFlow, c, st).options.map((o) => o.id)).toEqual(["yes"]);
  });

  it("every state's flow ends: no dead ends, at most 2 taps", () => {
    for (const from of FROMS) {
      const r = checkFlow(lifecycleFlow, [{ ctx: ctxFor(from), values: {} }]);
      expect(r.deadEnds).toEqual([]);
      expect(r.longest).toBeLessThanOrEqual(2);
    }
  });

  it("the consequence line says what the move means, in words", () => {
    const c = ctxFor("blocked");
    const v = viewStep(lifecycleFlow, c, startFlow(lifecycleFlow, c));
    expect(v.options.find((o) => o.id === "active")?.sub).toBeTruthy();
  });

  it("the done line states the customer and the move", () => {
    const c = ctxFor("lead");
    const st = answerStep(lifecycleFlow, c, startFlow(lifecycleFlow, c), "qualified");
    const chips = lifecycleChips(c, st).join(" | ");
    expect(chips).toContain("بقالی رضا");
    expect(chips).toContain(LIFECYCLE_LABEL.qualified);
  });
});
