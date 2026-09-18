import { describe, it, expect } from "vitest";
import { startFlow, viewStep, answerStep } from "@/lib/crm/flows/machine";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import type { FlowContext, FlowSet } from "@/lib/crm/flows/types";

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

  it("convert step sets convert_location when yes", () => {
    const s1 = startFlow(leadVisitFlow, makeCtx());
    const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
    const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "ok");
    const s4 = answerStep(leadVisitFlow, makeCtx(), s3, "buy");
    const s5 = answerStep(leadVisitFlow, makeCtx(), s4, "yes");
    expect(s5.acc.convert_location).toBe(true);
  });

  it("rate step is reachable from both branches", () => {
    const s1 = startFlow(leadVisitFlow, makeCtx());
    const s2 = answerStep(leadVisitFlow, makeCtx(), s1, "go");
    const s3 = answerStep(leadVisitFlow, makeCtx(), s2, "ok");
    const s4 = answerStep(leadVisitFlow, makeCtx(), s3, "closed");
    const s5 = answerStep(leadVisitFlow, makeCtx(), s4, "no");
    expect(stepId(s5)).toBe("rate");
  });
});