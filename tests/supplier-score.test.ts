import { describe, it, expect } from "vitest";
import { scorecard } from "@/lib/supplierScore";

describe("F31 supplier scorecard", () => {
  it("counts on time, average lateness of the late ones, and short closes", () => {
    const s = scorecard([
      { status: "received", expected_date: "2026-11-10", arrived_day: "2026-11-09" },
      { status: "received", expected_date: "2026-11-10", arrived_day: "2026-11-10" },
      { status: "received", expected_date: "2026-11-10", arrived_day: "2026-11-12" },
      { status: "received", expected_date: "2026-11-10", arrived_day: "2026-11-11" },
      { status: "received", expected_date: null, arrived_day: "2026-11-11" }, // no promise: not judged
      { status: "closed", expected_date: "2026-11-10", arrived_day: null },
    ]);
    expect(s).toEqual({ finished: 6, judged: 4, onTime: 2, avgLateDays: 1.5, closedShort: 1 });
  });
  it("is all zeros for no orders", () => {
    expect(scorecard([])).toEqual({ finished: 0, judged: 0, onTime: 0, avgLateDays: 0, closedShort: 0 });
  });
});
