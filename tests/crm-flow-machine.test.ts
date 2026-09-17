import { describe, it, expect } from "vitest";
import type { FlowConfig } from "@/lib/crm/flows/types";
import { EMPTY_CONTEXT } from "@/lib/crm/flows/types";
import { startFlow, viewStep, answerStep, backStep, replayAnswers, FlowError, SKIP } from "@/lib/crm/flows/machine";
import { checkFlow } from "@/lib/crm/flows/validate";

const cfg: FlowConfig = {
  id: "t",
  start: () => "a",
  skipStep: "skip",
  budget: { common: 3, longest: 4 },
  steps: {
    a: { id: "a", kind: "choice", q: "سلام {name}", options: [
      { id: "x", label: "ایکس", next: "b", set: { outcome: "TALKED" } },
      { id: "y", label: "وای", next: (_c, s) => (s.acc.outcome === "TALKED" ? "b" : "c") },
    ] },
    b: { id: "b", kind: "input", q: "نام", input: { field: "new_name", placeholder: "…" }, options: [{ id: "ok", label: "ادامه", next: "c" }] },
    c: { id: "c", kind: "choice", q: "کی؟", timeStep: true, options: [
      { id: "t1", label: "فردا", save: true, set: { due: { kind: "tomorrow", hour: 10 }, next_title: "تماس" } },
    ] },
    skip: { id: "skip", kind: "choice", q: "چرا؟", options: [{ id: "s", label: "سایر", save: true, set: { skip_reason: "OTHER", due: { kind: "none" } } }] },
  },
};
const ctx = { ...EMPTY_CONTEXT, vars: { name: "علی" } };

describe("machine", () => {
  it("renders interpolated questions", () => {
    expect(viewStep(cfg, ctx, startFlow(cfg, ctx)).q).toBe("سلام علی");
  });
  it("walks, merges sets, stores input values and saves on a save option", () => {
    let st = startFlow(cfg, ctx);
    st = answerStep(cfg, ctx, st, "x");
    st = answerStep(cfg, ctx, st, "ok", "کافه نو");
    expect(st.values.new_name).toBe("کافه نو");
    st = answerStep(cfg, ctx, st, "t1");
    expect(st.saved).toBe(true);
    expect(st.acc).toMatchObject({ outcome: "TALKED", next_title: "تماس" });
    expect(() => answerStep(cfg, ctx, st, "t1")).toThrow(FlowError);
  });
  it("requires a value for a required input", () => {
    const st = answerStep(cfg, ctx, startFlow(cfg, ctx), "x");
    expect(() => answerStep(cfg, ctx, st, "ok")).toThrow(FlowError);
  });
  it("routes through a next function and a skip", () => {
    let st = answerStep(cfg, ctx, startFlow(cfg, ctx), "y");
    expect(st.stack.at(-1)).toBe("c");
    st = answerStep(cfg, ctx, st, SKIP);
    expect(st.stack.at(-1)).toBe("skip");
    st = answerStep(cfg, ctx, st, "s");
    expect(st.acc.skip_reason).toBe("OTHER");
  });
  it("goes back one step keeping earlier answers", () => {
    let st = answerStep(cfg, ctx, startFlow(cfg, ctx), "x");
    st = answerStep(cfg, ctx, st, "ok", "کافه نو");
    st = backStep(cfg, ctx, st);
    expect(st.stack.at(-1)).toBe("b");
    expect(st.acc.outcome).toBe("TALKED");
  });
  it("replays answers and rejects an answer for the wrong step", () => {
    const st = replayAnswers(cfg, ctx, [{ step: "a", option: "y" }, { step: "c", option: "t1" }]);
    expect(st.saved).toBe(true);
    expect(() => replayAnswers(cfg, ctx, [{ step: "c", option: "t1" }])).toThrow(FlowError);
  });
});

describe("checkFlow", () => {
  it("measures shortest and longest save paths", () => {
    const r = checkFlow(cfg, [{ ctx, values: { b: "کافه" } }]);
    expect(r.deadEnds).toEqual([]);
    expect(r.shortest).toBe(2);
    expect(r.longest).toBe(3);
  });
  it("reports an option that goes nowhere", () => {
    const broken: FlowConfig = { ...cfg, steps: { ...cfg.steps, a: { ...cfg.steps.a, options: [{ id: "z", label: "ز", next: "missing" }] } } };
    expect(checkFlow(broken, [{ ctx, values: {} }]).deadEnds.length).toBeGreaterThan(0);
  });
});
