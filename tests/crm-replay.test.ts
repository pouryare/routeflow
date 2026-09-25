import { describe, it, expect } from "vitest";
import { OUTCOMES, OUTCOME_CODES } from "@/lib/crm/outcomes";
import { replayCrmState, INITIAL_STATE, type ActivityFacts } from "@/lib/crm/replay";
import { TEMPERATURES, CONTACT_STATUSES, SALES_STAGES, type Verification } from "@/lib/crm/vocab";

const act = (at: string, f: Partial<ActivityFacts>): ActivityFacts => ({
  occurred_at: at, contact_status_to: null, stage_to: null, verification_to: null, signal: null,
  attempt: 0, miss: 0, talked: 0, ...f,
});
const fromOutcome = (at: string, code: keyof typeof OUTCOMES): ActivityFacts => {
  const o = OUTCOMES[code];
  return act(at, { contact_status_to: o.contact_status, stage_to: o.stage, signal: o.signal, attempt: o.attempt ? 1 : 0, miss: o.miss ? 1 : 0, talked: o.talked ? 1 : 0 });
};

describe("OUTCOMES", () => {
  it("covers every code; a miss is always an attempt; a talk is never a miss", () => {
    for (const c of OUTCOME_CODES) {
      const o = OUTCOMES[c];
      expect(o).toBeTruthy();
      if (o.miss) expect(o.attempt).toBe(true);
      if (o.talked) expect(o.miss).toBe(false);
    }
  });
  it("uses only known vocabulary values", () => {
    for (const c of OUTCOME_CODES) {
      const o = OUTCOMES[c];
      if (o.contact_status) expect(CONTACT_STATUSES).toContain(o.contact_status);
      if (o.stage) expect(SALES_STAGES).toContain(o.stage);
      if (o.signal) expect(TEMPERATURES).toContain(o.signal);
    }
  });
  it("maps misses, cold returns, and no-op outcomes distinctly", () => {
    // A closed shop is a MISS, not a no-op and not a talk: the driver was there and came
    // away with nothing, which is an attempt worth counting and a visit worth retrying.
    // This assertion used to expect the no-op shape and grouped VISIT_CLOSED with INVALID,
    // which contradicted outcomes.ts ("a closed shop is a miss, not a talk"), the
    // no_answer status write.ts derives from it, and the reminder the visit flow offers.
    // Only INVALID is a genuine no-op.
    expect(OUTCOMES.NO_ANSWER).toMatchObject({ contact_status: "no_answer", miss: true, talked: false, signal: null });
    expect(OUTCOMES.NOT_INTERESTED).toMatchObject({ stage: "not_interested", talked: true, signal: "cold" });
    expect(OUTCOMES.VISIT_CLOSED).toEqual({ contact_status: null, stage: null, signal: null, attempt: true, miss: true, talked: false });
    expect(OUTCOMES.INVALID).toEqual({ contact_status: null, stage: null, signal: null, attempt: false, miss: false, talked: false });
  });
});

describe("replayCrmState", () => {
  it("starts from the initial state", () => expect(replayCrmState([])).toEqual(INITIAL_STATE));

  it("counts attempts and consecutive misses, and a talk resets the streak", () => {
    const s = replayCrmState([
      fromOutcome("2026-09-01T08:00:00.000Z", "NO_ANSWER"),
      fromOutcome("2026-09-02T08:00:00.000Z", "BUSY"),
      fromOutcome("2026-09-03T08:00:00.000Z", "ASKED_PRICE"),
      fromOutcome("2026-09-04T08:00:00.000Z", "NO_ANSWER"),
    ]);
    expect(s.attempt_count).toBe(4);
    expect(s.consecutive_misses).toBe(1);
    expect(s.contact_status).toBe("no_answer");
    expect(s.sales_stage).toBe("interested");
    expect(s.last_contacted_at).toBe("2026-09-03T08:00:00.000Z");
    expect(s.last_activity_at).toBe("2026-09-04T08:00:00.000Z");
    expect(s.temperature).toBe("hot");
  });

  it("folds verification and forward-only stages", () => {
    const s = replayCrmState([
      act("2026-09-01T08:00:00.000Z", { verification_to: "unverified" }),
      act("2026-09-02T08:00:00.000Z", { verification_to: "renamed", stage_to: "sample", talked: 1, contact_status_to: "contacted", attempt: 1 }),
      act("2026-09-03T08:00:00.000Z", { stage_to: "interested" }),
    ]);
    expect(s.verification).toBe("renamed");
    expect(s.sales_stage).toBe("sample");
  });

  it("is order-dependent: the fold follows the array, not the clock", () => {
    const events = [
      act("2026-09-01T08:00:00.000Z", { verification_to: "verified" }),
      act("2026-09-02T08:00:00.000Z", { verification_to: "wrong_number" }),
    ];
    expect(replayCrmState(events).verification).toBe("wrong_number");
    expect(replayCrmState([...events].reverse()).verification).toBe("verified");
  });

  it("rejects an activity row with an unknown verification value", () => {
    // The fold is typed; a bad row from the DB must not silently pass through.
    const bad = act("2026-09-01T08:00:00.000Z", { verification_to: "bogus" as Verification });
    expect(() => replayCrmState([bad])).toThrow();
  });

  it("stays cold with no signals and cools as later activities pass", () => {
    const s = replayCrmState([fromOutcome("2026-09-01T08:00:00.000Z", "ASKED_PRICE")]);
    expect(s.temperature).toBe("hot");
    // The replay is deterministic as of the last activity: a hot signal on July 1 is hot
    // on July 1. Cooling happens when a later signal-less activity becomes the fold's end.
    const aged = replayCrmState([
      fromOutcome("2026-07-01T08:00:00.000Z", "ASKED_PRICE"),
      fromOutcome("2026-08-15T08:00:00.000Z", "NO_ANSWER"),
    ]);
    expect(aged.temperature).toBe("cold");
  });
});
