import { describe, it, expect } from "vitest";
import { latestPlans, planToEditable } from "@/lib/commission/copyPlan";

const tiers = [
  { from_value: 0, to_value: 100, rate_type: "flat" as const, rate_value: 1000 },
  { from_value: 100, to_value: null, rate_type: "pct" as const, rate_value: 2.5 },
];
const row = (id: number | null, from: string, mode: "marginal" | "cliff" = "marginal") => ({
  salesperson_user_id: id, valid_from: from, mode, metric: "kg" as const, tiers,
});

describe("copy a commission plan", () => {
  it("keeps the latest plan per person, company first, unnamed people out", () => {
    const out = latestPlans(
      [row(5, "2026-01-01"), row(5, "2026-06-01", "cliff"), row(null, "2025-01-01"), row(9, "2026-01-01")],
      new Map([[5, "علی"]]),
    );
    expect(out.map((o) => o.id)).toEqual(["company", "5"]);
    expect(out[1].plan.mode).toBe("cliff");
  });
  it("turns a plan into editable rows with the last tier open-ended", () => {
    expect(planToEditable({ mode: "marginal", metric: "kg", tiers })).toEqual({
      mode: "marginal",
      metric: "kg",
      rows: [
        { from: "0", to: "100", rate: "1000", type: "flat" },
        { from: "100", to: "", rate: "2.5", type: "pct" },
      ],
    });
  });
});
