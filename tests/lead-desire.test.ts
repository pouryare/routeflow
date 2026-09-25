import { describe, expect, it } from "vitest";
import {
  LEAD_VISIT_OUTCOMES,
  nextActionFor,
  visitOutcomeLabel,
  type LeadVisitOutcome,
} from "@/lib/crm/leadDesire";
import { NEXT_KINDS } from "@/lib/crm/vocab";
import { OUTCOME_CODES } from "@/lib/crm/outcomes";
import { leadVisitFlow } from "@/lib/crm/flows/leadVisit";
import type { FlowOption } from "@/lib/crm/flows/types";

/** Rule 2 of the lead work: the driver reports, the code decides. These tests hold the
 *  decision to that, with no database and no HTTP -- the whole vocabulary is a pure read of
 *  one column, so it can be pinned here rather than through the route. */

describe("the outcomes a driver can leave behind", () => {
  it("are all real outcome codes, so the column they fill is constrained", () => {
    for (const o of LEAD_VISIT_OUTCOMES) {
      expect(OUTCOME_CODES).toContain(o);
    }
  });

  it("cover every outcome the visit flow can actually set", () => {
    // Walk the flow's own options rather than trusting the list above to stay in step: an
    // outcome the flow can produce but this module cannot read would show up as a lead
    // whose card says nothing about what just happened. Compared both ways on purpose --
    // a one-way subset check would also pass if the walk found nothing at all.
    const reachable = new Set<string>();
    for (const step of Object.values(leadVisitFlow.steps)) {
      const options = typeof step.options === "function" ? step.options({} as never, {} as never) : step.options;
      for (const o of options as FlowOption[]) {
        if (o.set?.outcome) reachable.add(o.set.outcome);
      }
    }
    expect([...reachable].sort()).toEqual([...LEAD_VISIT_OUTCOMES].sort());
  });
});

describe("the follow-up a visit derives", () => {
  it("turns a ready buyer into an order -- rule 1 is a purchase, not a flag", () => {
    expect(nextActionFor("READY_TO_BUY")).toBe("order");
  });

  it("hands an interested lead to a phone call rather than back to the driver", () => {
    expect(nextActionFor("INTERESTED")).toBe("call");
  });

  it("retries every miss a later visit could fix", () => {
    for (const miss of ["ACCESS_FAILED", "VISIT_CLOSED", "VISIT_NO_OWNER", "VISIT_WRONG_ADDRESS", "VISIT_NEW_BUILDING"]) {
      expect(nextActionFor(miss), miss).toBe("reminder");
    }
  });

  it("derives nothing from a plain visit, or from a lead never visited", () => {
    expect(nextActionFor("VISITED")).toBeNull();
    expect(nextActionFor(null)).toBeNull();
    expect(nextActionFor(undefined)).toBeNull();
    expect(nextActionFor("")).toBeNull();
  });

  it("only ever answers with a task kind the rest of the app already knows", () => {
    for (const o of LEAD_VISIT_OUTCOMES) {
      const action = nextActionFor(o);
      if (action !== null) expect(NEXT_KINDS, `${o} -> ${action}`).toContain(action);
    }
  });

  it("derives no follow-up from a code it does not recognise", () => {
    // The column is free text, so a row from an older build must not invent a task in
    // somebody's list. Silence is the safe answer; a guess is not.
    expect(nextActionFor("NO_ANSWER")).toBeNull();
    expect(nextActionFor("SOMETHING_NEW")).toBeNull();
  });
});

/** nextActionFor reads the outcome alone, so it is only correct while INTERESTED means
 *  "interested but unreachable by phone". That is a property of the flow, not of this
 *  module, and it is the kind of property that decays silently when someone adds an option. */
describe("why reading INTERESTED alone is safe", () => {
  const optionsOf = (step: string) => leadVisitFlow.steps[step].options as FlowOption[];

  it("holds today: the only option that sets INTERESTED also hands off to sales", () => {
    const interested = optionsOf("detail_status").filter((o) => o.set?.outcome === "INTERESTED");
    expect(interested.length).toBeGreaterThan(0);
    for (const o of interested) {
      expect(o.set?.handoff_sales, `${o.id} sets INTERESTED without a handoff`).toBe(true);
    }
  });

  it("and no other step in the flow sets INTERESTED behind a different back", () => {
    for (const step of Object.values(leadVisitFlow.steps)) {
      const options = (typeof step.options === "function"
        ? step.options({} as never, {} as never)
        : step.options) as FlowOption[];
      for (const o of options) {
        if (o.set?.outcome === "INTERESTED") {
          expect(o.set?.handoff_sales, `${step.id}/${o.id}`).toBe(true);
        }
      }
    }
  });
});

describe("the words on the card", () => {
  it("say a lead has not been visited when there is no outcome", () => {
    expect(visitOutcomeLabel(null)).toBe("هنوز بازدید نشده");
  });

  it("reuse the flow's own option labels, so the card says what the driver tapped", () => {
    expect(visitOutcomeLabel("READY_TO_BUY")).toBe("آماده خرید");
    expect(visitOutcomeLabel("VISIT_NO_OWNER")).toBe("صاحب‌ش نبود");
    expect(visitOutcomeLabel("VISIT_WRONG_ADDRESS")).toBe("آدرس اشتباه");
  });

  it("still read as a visit for a code this build does not know", () => {
    expect(visitOutcomeLabel("SOMETHING_NEW")).toBe("بازدید ثبت شد");
  });

  it("has a label for every outcome the flow can set", () => {
    for (const o of LEAD_VISIT_OUTCOMES) {
      expect(visitOutcomeLabel(o as LeadVisitOutcome).length, o).toBeGreaterThan(0);
    }
  });
});
