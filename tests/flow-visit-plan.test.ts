import { describe, it, expect } from "vitest";
import { EMPTY_CONTEXT, type FlowContext } from "@/lib/crm/flows/types";
import { startFlow, answerStep, viewStep } from "@/lib/crm/flows/machine";
import { visitPlanFlow, visitPlanRequest, visitPlanChips, whoChoices } from "@/lib/flows/visitPlan";
import { assertFlowBudget, assertNoRawEnumLabels } from "./helpers/flowAssert";

const ctx: FlowContext = {
  ...EMPTY_CONTEXT,
  entry: "visit_plan",
  items: [
    { id: 5, label: "بقالی رضا (C-5)" },
    { id: 6, label: "نانوایی سنگک (C-6)" },
    { id: -9, label: "کافه نو · سرنخ" }, // negative id = a saved lead location
  ],
  vars: { today: "2026-10-21", selected: "2026-10-23" },
};

describe("visit-plan quick add", () => {
  it("meets its tap budget with no dead ends", () => {
    assertFlowBudget(visitPlanFlow, [{ ctx, values: { who: "c5", day_pick: "2026-11-01" } }]);
    assertNoRawEnumLabels(visitPlanFlow);
  });

  it("the day being looked at is the suggestion, so adding to it is 2 taps", () => {
    let st = startFlow(visitPlanFlow, ctx);
    st = answerStep(visitPlanFlow, ctx, st, "pick", "c5");
    const day = viewStep(visitPlanFlow, ctx, st);
    expect(day.options.find((o) => o.tone === "rec")?.id).toBe("selected");
    st = answerStep(visitPlanFlow, ctx, st, "selected");
    expect(st.saved).toBe(true);
    expect(st.answers).toHaveLength(2);
    expect(visitPlanRequest(ctx, st)).toEqual({ entity_type: "customer", entity_id: 5, planned_date: "2026-10-23" });
  });

  it("a lead goes to the plan as a lead location, not a customer", () => {
    let st = startFlow(visitPlanFlow, ctx);
    st = answerStep(visitPlanFlow, ctx, st, "pick", "l9");
    st = answerStep(visitPlanFlow, ctx, st, "tomorrow");
    expect(visitPlanRequest(ctx, st)).toEqual({ entity_type: "lead_location", entity_id: 9, planned_date: "2026-10-22" });
  });

  it("today, tomorrow and a calendar day are all offered", () => {
    let st = startFlow(visitPlanFlow, ctx);
    st = answerStep(visitPlanFlow, ctx, st, "pick", "c6");
    expect(viewStep(visitPlanFlow, ctx, st).options.map((o) => o.id)).toEqual(["selected", "today", "tomorrow", "other"]);
    st = answerStep(visitPlanFlow, ctx, st, "other");
    expect(viewStep(visitPlanFlow, ctx, st).id).toBe("day_pick");
    st = answerStep(visitPlanFlow, ctx, st, "ok", "2026-11-01");
    expect(visitPlanRequest(ctx, st).planned_date).toBe("2026-11-01");
  });

  it("when the day being looked at IS today, it is not offered twice", () => {
    const same = { ...ctx, vars: { ...ctx.vars, selected: "2026-10-21" } };
    let st = startFlow(visitPlanFlow, same);
    st = answerStep(visitPlanFlow, same, st, "pick", "c5");
    expect(viewStep(visitPlanFlow, same, st).options.map((o) => o.id)).toEqual(["selected", "tomorrow", "other"]);
  });

  it("a screen that knows the customer skips the question", () => {
    const known = { ...ctx, vars: { ...ctx.vars, entity: "c5" } };
    expect(viewStep(visitPlanFlow, known, startFlow(visitPlanFlow, known)).id).toBe("day");
    const st = answerStep(visitPlanFlow, known, startFlow(visitPlanFlow, known), "today");
    expect(visitPlanRequest(known, st)).toMatchObject({ entity_type: "customer", entity_id: 5, planned_date: "2026-10-21" });
  });

  it("splits the choice list into customers and leads and keeps their ids apart", () => {
    const choices = whoChoices(ctx);
    expect(choices.map((c) => c.id)).toEqual(["c5", "c6", "l9"]);
  });

  it("the done line says who, and which day", () => {
    let st = startFlow(visitPlanFlow, ctx);
    st = answerStep(visitPlanFlow, ctx, st, "pick", "c6");
    st = answerStep(visitPlanFlow, ctx, st, "selected");
    const chips = visitPlanChips(ctx, st).join(" | ");
    expect(chips).toContain("نانوایی سنگک");
    expect(chips).toContain("برنامه");
  });
});
