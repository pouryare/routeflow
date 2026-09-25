import { describe, it, expect } from "vitest";
import { startFlow, viewStep, answerStep } from "@/lib/crm/flows/machine";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import type { FlowContext, FlowOption, FlowSet } from "@/lib/crm/flows/types";

const makeCtx = (): FlowContext => ({
  entry: "driver_visit",
  firstContact: true,
  attemptNo: 1,
  maxMisses: 5,
  isManager: false,
  vars: { name: "کافه نو", address: "خیابان مولوی" },
  knownContacts: [],
  products: [],
  reps: [],
  recentCustomers: [],
});

const stepId = (st: ReturnType<typeof startFlow>) => st.stack[st.stack.length - 1];

describe("leadVisit flow machine", () => {
  it("starts at navigate", () => {
    const s = startFlow(leadVisitFlow, makeCtx());
    expect(stepId(s)).toBe("navigate");
  });

  it("success branch: navigate → what_happened → detail_status", () => {
    const s1 = startFlow(leadVisitFlow, makeCtx());
    const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
    expect(stepId(s2)).toBe("what_happened");
    const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "ok");
    expect(stepId(s3)).toBe("detail_status");
  });

  it("failure branch: what_happened=no → why_failed", () => {
    const s1 = startFlow(leadVisitFlow, makeCtx());
    const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
    const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "no");
    expect(stepId(s3)).toBe("why_failed");
  });

  it("reminder branch: why_failed → reminder", () => {
    const s1 = startFlow(leadVisitFlow, makeCtx());
    const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
    const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "no");
    const s4 = answerStep(leadVisitFlow, makeCtx(), s3, "closed");
    expect(stepId(s4)).toBe("reminder");
  });

  it("success branch sets handoff_sales for partial interest", () => {
    const s1 = startFlow(leadVisitFlow, makeCtx());
    const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
    const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "ok");
    const s4 = answerStep(leadVisitFlow, makeCtx(), s3, "partial");
    expect(s4.acc.handoff_sales).toBe(true);
  });

  it("a ready buyer is asked to write the order down, not to convert the lead", () => {
    // This used to read: buy -> convert -> "yes" sets convert_location. The convert step
    // asked the driver for a commercial decision and then discarded the answer, so it is
    // gone. What is left asks the only question a driver can answer -- did they buy now --
    // and both answers leave an order task behind for whoever does the paperwork.
    const s1 = startFlow(leadVisitFlow, makeCtx());
    const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
    const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "ok");
    const s4 = answerStep(leadVisitFlow, makeCtx(), s3, "buy");
    expect(stepId(s4)).toBe("sold");
    expect(s4.acc.outcome).toBe("READY_TO_BUY");
  });

  it("both sold answers create an order task; only the immediate one offers the page", () => {
    const at = (option: string) => {
      const s1 = startFlow(leadVisitFlow, makeCtx());
      const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
      const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "ok");
      const s4 = answerStep(leadVisitFlow, makeCtx(), s3, "buy");
      return answerStep(leadVisitFlow, makeCtx(), s4, option);
    };
    // "now" -- bought at the door, so the driver can write it up before driving off.
    const now = at("now");
    expect(now.acc.next_kind).toBe("order");
    expect(now.acc.due).toEqual({ kind: "in_hours", hours: 0 });
    expect(now.acc.open_order).toBe(true);
    // "office" -- not yet, but the office still needs to know. The task is the safety
    // net for a ready buyer who walks away unrecorded.
    const office = at("office");
    expect(office.acc.next_kind).toBe("order");
    expect(office.acc.open_order).toBeUndefined();
  });

  it("never asks the driver to convert, and offers no such answer", () => {
    // The dead end is gone from the flow itself, not merely ignored: no step may carry the
    // question, and no accumulator key may be left behind for one.
    for (const step of Object.values(leadVisitFlow.steps)) {
      expect(step.id, "a convert step is back").not.toBe("convert");
      for (const option of step.options as FlowOption[]) {
        expect(option.label).not.toContain("مشتری");
        expect(Object.keys(option.set ?? {})).not.toContain("convert_location");
      }
    }
  });

  it("rate step is reachable from both branches", () => {
    // The success branch used to pass through `convert` on its way to the stars, so this
    // needed an extra answer to get there. It reaches rate directly now, which is the
    // point of dropping that step: one tap fewer between the door and the stars.
    const s1 = startFlow(leadVisitFlow, makeCtx());
    const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
    const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "ok");
    const s4 = answerStep(leadVisitFlow, makeCtx(), s3, "closed");
    expect(stepId(s4)).toBe("rate");
    // And from the failure branch, by way of the reminder the driver may set.
    const f1 = startFlow(leadVisitFlow, makeCtx());
    const f2 = answerStep(leadVisitFlow, makeCtx(), f1, "go");
    const f3 = answerStep(leadVisitFlow, makeCtx(), f2, "no");
    const f4 = answerStep(leadVisitFlow, makeCtx(), f3, "closed");
    const f5 = answerStep(leadVisitFlow, makeCtx(), f4, "tomorrow");
    expect(stepId(f5)).toBe("rate");
  });
});