import { describe, it, expect } from "vitest";
import { startFlow, answerStep, backStep } from "@/lib/crm/flows/machine";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import type { FlowContext } from "@/lib/crm/flows/types";
import { EMPTY_CONTEXT } from "@/lib/crm/flows/types";

function makeCtx(overrides = {}): FlowContext {
  return { ...EMPTY_CONTEXT, entry: "driver_visit" as const, firstContact: true, ...overrides };
}

describe("LocationTapFlow logic", () => {
  it("starts flow at navigate step", () => {
    const state = startFlow(leadVisitFlow, makeCtx());
    expect(state.stack).toEqual(["navigate"]);
    expect(state.saved).toBe(false);
  });

  it("advances from navigate to what_happened", () => {
    const ctx = makeCtx();
    const s1 = startFlow(leadVisitFlow, ctx);
    const s2 = answerStep(leadVisitFlow, ctx, s1, "go");
    expect(s2.stack).toEqual(["navigate", "what_happened"]);
  });

  it("what_happened options lead to correct branches", () => {
    const ctx = makeCtx();
    const s1 = startFlow(leadVisitFlow, ctx);
    const s2 = answerStep(leadVisitFlow, ctx, s1, "go");
    const s3a = answerStep(leadVisitFlow, ctx, s2, "ok");
    expect(s3a.stack).toContain("detail_status");
    const s3b = answerStep(leadVisitFlow, ctx, s2, "no");
    expect(s3b.stack).toContain("why_failed");
  });

  it("backStep returns to previous step", () => {
    const ctx = makeCtx();
    const s1 = startFlow(leadVisitFlow, ctx);
    const s2 = answerStep(leadVisitFlow, ctx, s1, "go");
    const prev = backStep(leadVisitFlow, ctx, s2);
    expect(prev.stack).toEqual(["navigate"]);
  });

  it("convert step leads to rate step", () => {
    const ctx = makeCtx();
    const s1 = startFlow(leadVisitFlow, ctx);
    const s2 = answerStep(leadVisitFlow, ctx, s1, "go");
    const s3 = answerStep(leadVisitFlow, ctx, s2, "ok");
    const s4 = answerStep(leadVisitFlow, ctx, s3, "buy");
    const s5 = answerStep(leadVisitFlow, ctx, s4, "now");
    expect(s5.stack).toContain("rate");
  });

  it("stars step sets acc.stars and advances to skip", () => {
    const ctx = makeCtx();
    const s1 = startFlow(leadVisitFlow, ctx);
    const s2 = answerStep(leadVisitFlow, ctx, s1, "go");
    const s3 = answerStep(leadVisitFlow, ctx, s2, "ok");
    const s4 = answerStep(leadVisitFlow, ctx, s3, "buy");
    const s5 = answerStep(leadVisitFlow, ctx, s4, "now");
    const s6 = answerStep(leadVisitFlow, ctx, s5, "stars", "4,3,5");
    expect(s6.saved).toBe(false);
    expect(s6.acc.stars).toEqual({ potential: 4, volume: 3, ease: 5 });
    expect(s6.stack).toContain("skip");
  });

  it("flow saves at skip step", () => {
    const ctx = makeCtx();
    const s1 = startFlow(leadVisitFlow, ctx);
    const s2 = answerStep(leadVisitFlow, ctx, s1, "go");
    const s3 = answerStep(leadVisitFlow, ctx, s2, "ok");
    const s4 = answerStep(leadVisitFlow, ctx, s3, "buy");
    const s5 = answerStep(leadVisitFlow, ctx, s4, "now");
    const s6 = answerStep(leadVisitFlow, ctx, s5, "stars", "5,4,5");
    const s7 = answerStep(leadVisitFlow, ctx, s6, "WAITING_ON_THEM"); // skip has save: true
    expect(s7.saved).toBe(true);
  });

  it("handles full success flow end-to-end", () => {
    const ctx = makeCtx();
    const s1 = startFlow(leadVisitFlow, ctx);
    const s2 = answerStep(leadVisitFlow, ctx, s1, "go");
    const s3 = answerStep(leadVisitFlow, ctx, s2, "ok");
    const s4 = answerStep(leadVisitFlow, ctx, s3, "buy");
    const s5 = answerStep(leadVisitFlow, ctx, s4, "now");
    const s6 = answerStep(leadVisitFlow, ctx, s5, "stars", "5,4,5");
    const s7 = answerStep(leadVisitFlow, ctx, s6, "WAITING_ON_THEM");
    expect(s7.saved).toBe(true);
    expect(s7.acc.outcome).toBe("READY_TO_BUY");
    // A driver who closed the sale at the door leaves an order behind, and the host is
    // told to offer the order page. This assertion used to be `convert_location` -- the
    // flag the removed convert step set, which nothing ever read.
    expect(s7.acc.next_kind).toBe("order");
    expect(s7.acc.open_order).toBe(true);
  });

  it("handles failure flow with reminder to rate", () => {
    const ctx = makeCtx();
    const s1 = startFlow(leadVisitFlow, ctx);
    const s2 = answerStep(leadVisitFlow, ctx, s1, "go");
    const s3 = answerStep(leadVisitFlow, ctx, s2, "no");
    const s4 = answerStep(leadVisitFlow, ctx, s3, "closed");
    const s5 = answerStep(leadVisitFlow, ctx, s4, "tomorrow");
    expect(s5.stack).toContain("rate");
  });

  it("ctx has correct driver_visit defaults", () => {
    const ctx = makeCtx();
    expect(ctx.entry).toBe("driver_visit");
    expect(ctx.firstContact).toBe(true);
    expect(ctx.attemptNo).toBe(1);
    expect(ctx.maxMisses).toBe(5);
    expect(ctx.isManager).toBe(false);
  });
});
