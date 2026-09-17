import { describe, it, expect } from "vitest";
import { advanceStage, lifecycleFor, stageRank } from "@/lib/crm/stage";
import { autoTemperature, DEFAULT_WINDOWS } from "@/lib/crm/temperature";
import { SALES_STAGES, CUSTOMER_STAGES, type SalesStage } from "@/lib/crm/vocab";

describe("advanceStage", () => {
  it("ranks every stage along the funnel", () => {
    expect(SALES_STAGES.map(stageRank)).toEqual([0, 0, 1, 2, 3, 4, 5, 6, 7, 0]);
  });
  it("moves only forward along the active funnel", () => {
    const funnel: SalesStage[] = ["interested", "sample", "quotation", "negotiation", "first_order", "customer", "repeat_customer"];
    for (const [i, current] of funnel.entries()) {
      for (const [j, next] of funnel.entries()) {
        expect(advanceStage(current, next)).toBe(j > i ? next : current);
      }
      expect(advanceStage(current, "unknown")).toBe(current);
    }
  });
  it("keeps the current stage with no new fact or an identical fact", () => {
    for (const stage of SALES_STAGES) {
      expect(advanceStage(stage, null)).toBe(stage);
      expect(advanceStage(stage, stage)).toBe(stage);
    }
  });
  it("lets leads go cold and resume at any stage", () => {
    expect(advanceStage("negotiation", "not_interested")).toBe("not_interested");
    expect(advanceStage("quotation", "lost")).toBe("lost");
    for (const current of ["unknown", "not_interested", "lost"] as const) {
      expect(advanceStage(current, "interested")).toBe("interested");
      expect(advanceStage(current, "sample")).toBe("sample");
    }
  });
  it("never demotes customers through a cold call outcome", () => {
    for (const current of CUSTOMER_STAGES) {
      expect(advanceStage(current, "lost")).toBe(current);
      expect(advanceStage(current, "not_interested")).toBe(current);
    }
  });
});

describe("lifecycleFor", () => {
  it("maps every sales stage to the existing coarse lifecycle", () => {
    expect(SALES_STAGES.map((stage) => lifecycleFor(stage, "lead"))).toEqual([
      "lead", "lead", "qualified", "sampled", "qualified", "qualified",
      "active", "active", "active", "lost",
    ]);
  });
  it("never overwrites a credit block", () => {
    for (const stage of SALES_STAGES) expect(lifecycleFor(stage, "blocked")).toBe("blocked");
  });
  it("keeps dormant until an order-stage fact", () => {
    for (const stage of SALES_STAGES) {
      expect(lifecycleFor(stage, "dormant")).toBe(CUSTOMER_STAGES.includes(stage) ? "active" : "dormant");
    }
  });
});

describe("autoTemperature", () => {
  const now = "2026-09-11T10:00:00.000Z";
  const daysAgo = (days: number) => new Date(Date.parse(now) - days * 86_400_000).toISOString();

  it("defaults to cold when there are no eligible signals", () => {
    expect(DEFAULT_WINDOWS).toEqual({ hotDays: 14, warmDays: 30 });
    expect(autoTemperature([], now)).toBe("cold");
    expect(autoTemperature([{ at: daysAgo(-1), signal: "hot" }], now)).toBe("cold");
    expect(autoTemperature([{ at: daysAgo(31), signal: "hot" }], now)).toBe("cold");
  });
  it("cools hot signals at inclusive fourteen- and thirty-day boundaries", () => {
    for (const [days, expected] of [[0, "hot"], [14, "hot"], [14.001, "warm"], [30, "warm"], [30.001, "cold"]] as const) {
      expect(autoTemperature([{ at: daysAgo(days), signal: "hot" }], now)).toBe(expected);
    }
  });
  it("uses the latest signal regardless of array order and excludes future signals", () => {
    expect(autoTemperature([
      { at: daysAgo(1), signal: "cold" }, { at: daysAgo(5), signal: "hot" },
      { at: daysAgo(-1), signal: "hot" },
    ], now)).toBe("cold");
    expect(autoTemperature([{ at: daysAgo(2), signal: "warm" }], now)).toBe("warm");
  });
  it("uses the later activity for equal timestamps", () => {
    expect(autoTemperature([{ at: now, signal: "hot" }, { at: now, signal: "cold" }], now)).toBe("cold");
  });
  it("honors tenant-specific cooling windows", () => {
    const windows = { hotDays: 2, warmDays: 5 };
    expect(autoTemperature([{ at: daysAgo(2), signal: "hot" }], now, windows)).toBe("hot");
    expect(autoTemperature([{ at: daysAgo(3), signal: "hot" }], now, windows)).toBe("warm");
    expect(autoTemperature([{ at: daysAgo(6), signal: "warm" }], now, windows)).toBe("cold");
  });
});
