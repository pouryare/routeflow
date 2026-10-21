import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowConfig } from "@/lib/crm/flows/types";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const good: FlowConfig = {
  id: "g", start: () => "a", budget: { common: 2, longest: 2 },
  steps: {
    a: { id: "a", kind: "choice", q: "؟", options: [{ id: "x", label: "ایکس", next: "b" }] },
    b: { id: "b", kind: "choice", q: "؟", options: [{ id: "y", label: "ثبت", save: true }] },
  },
};
const ctx = { variants: [{ ctx: EMPTY_CONTEXT, values: {} }] };

describe("flow assertion helpers", () => {
  it("pass a flow inside its budget", () => {
    assertFlowBudget(good, ctx.variants);
    assertNoRawEnumLabels(good);
  });
  it("fail a flow whose real path is longer than declared", () => {
    expect(() => assertFlowBudget({ ...good, budget: { common: 1, longest: 1 } }, ctx.variants)).toThrow();
  });
  it("fail a declared budget beyond the doc's cap", () => {
    expect(() => assertFlowBudget({ ...good, budget: { common: 6, longest: 9 } }, ctx.variants)).toThrow();
  });
  it("catch a raw enum used as a label", () => {
    const bad: FlowConfig = { ...good, steps: { ...good.steps, a: { ...good.steps.a, options: [{ id: "x", label: "NO_ANSWER", next: "b" }] } } };
    expect(() => assertNoRawEnumLabels(bad)).toThrow();
  });
});
