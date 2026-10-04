import { describe, it, expect } from "vitest";
import {
  isUncommitted,
  requestedDayLabel,
  resolveRequestedDay,
  UNCOMMITTED_LABEL,
} from "@/lib/requestedDay";

/** The day a customer asked for — Phase 1 of the mixed-route plan.
 *
 *  The whole point of this module is that «در اولین فرصت» is the ABSENCE of a day, not a
 *  boolean column. An earlier shape of this work called it "ASAP", which reads as a flag and
 *  invites a `is_asap` column that then has to be kept in step with `requested_day`. There is
 *  no such flag here: `requested_day IS NULL` IS the label, and the day-splitter's raw
 *  material is exactly the set of orders where this returns true.
 *
 *  Pure, because this repo has no component tests — a rule that only lives inside a component
 *  is a rule nobody can assert. */

describe("requested day", () => {
  it("treats a null day as uncommitted — that IS «در اولین فرصت»", () => {
    expect(isUncommitted(null)).toBe(true);
    expect(isUncommitted("2026-10-05")).toBe(false);
  });

  it("labels an uncommitted order in Persian, not as a flag", () => {
    expect(requestedDayLabel(null)).toBe(UNCOMMITTED_LABEL);
    expect(UNCOMMITTED_LABEL).toBe("در اولین فرصت");
  });

  it("shows a committed order's Jalali date, never the ISO one", () => {
    const label = requestedDayLabel("2026-10-05");
    expect(label).not.toBe("2026-10-05");
    expect(label).not.toBe(UNCOMMITTED_LABEL);
  });

  it("resolves a week offset from a known today", () => {
    expect(resolveRequestedDay("week_offset", 1, "2026-10-03")).toBe("2026-10-10");
    expect(resolveRequestedDay("week_offset", 0, "2026-10-03")).toBe("2026-10-03");
    expect(resolveRequestedDay("week_offset", 3, "2026-10-03")).toBe("2026-10-24");
  });

  it("crosses a month boundary without drifting", () => {
    // 2026-10-30 + 1 week is 2026-11-06, not 2026-11-05. setUTCDate, not +7*86400000 ms:
    // the latter is fine for UTC dates, but anything that went through a local-time
    // constructor would slide a day and silently move the promise.
    expect(resolveRequestedDay("week_offset", 1, "2026-10-30")).toBe("2026-11-06");
  });

  it("refuses a negative offset rather than inventing a past day", () => {
    expect(() => resolveRequestedDay("week_offset", -1, "2026-10-03")).toThrow();
  });

  it("refuses a fractional offset — a third of a week is not a delivery day", () => {
    expect(() => resolveRequestedDay("week_offset", 1.5, "2026-10-03")).toThrow();
  });

  it("refuses an unparseable today rather than returning NaN", () => {
    expect(() => resolveRequestedDay("week_offset", 1, "not-a-date")).toThrow();
  });

  it("keeps an exact date exactly as given", () => {
    expect(resolveRequestedDay("exact_date", 0, "2026-11-20")).toBe("2026-11-20");
  });

  it("never resolves 'soonest' to a day — it has no offset to apply", () => {
    // «soonest» is the uncommitted state, so there is no date to compute. Returning today's
    // date here would be the worst possible answer: it would look like a commitment nobody
    // made, and the split would treat it as a pinned order.
    expect(() => resolveRequestedDay("soonest", 0, "2026-10-03")).toThrow();
  });
});