import { describe, expect, it } from "vitest";
import { allocate, legalReserve, settleGroup, shareOverhead, weightedShares, yearBounds } from "@/lib/profitSplit";

describe("allocate", () => {
  it("always adds up to the total", () => {
    for (const [total, w] of [[100, [1, 1, 1]], [1, [3, 3]], [999_999_937, [3333, 6667]], [0, [1, 2]], [10, [0, 0]]] as const) {
      const parts = allocate(total, [...w]);
      expect(parts.reduce((t, n) => t + n, 0)).toBe(w.every((x) => x === 0) ? 0 : total);
      expect(parts.every(Number.isInteger)).toBe(true);
    }
  });
  it("gives the extra Toman to the biggest remainder", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [6000, 4000])).toEqual([6, 4]);
  });
  it("refuses a negative or fractional total", () => {
    expect(() => allocate(-1, [1])).toThrow();
    expect(() => allocate(1.5, [1])).toThrow();
  });
});

describe("yearBounds", () => {
  it("is Farvardin 1 to the last day of Esfand", () => {
    expect(yearBounds(1405)).toEqual({ from: "2026-03-21", to: "2027-03-20" });
    expect(yearBounds(1403)).toEqual({ from: "2024-03-20", to: "2025-03-20" }); // 1403 is a leap year: 366 days
  });
});

describe("weightedShares", () => {
  const set = (validFrom: string, a: number, b: number): { validFrom: string; shares: { partyId: number; percentBp: number }[] } => ({
    validFrom, shares: [{ partyId: 1, percentBp: a }, { partyId: 2, percentBp: b }],
  });
  it("holds one set for the whole year", () => {
    const { weights, daysCovered } = weightedShares([set("2025-01-01", 6000, 4000)], "2026-03-21", "2027-03-20");
    expect(daysCovered).toBe(365);
    expect(weights.get(1)).toBe(6000 * 365);
  });
  it("weights a mid-year change by days", () => {
    const { weights } = weightedShares([set("2026-01-01", 6000, 4000), set("2026-09-23", 5000, 5000)], "2026-03-21", "2027-03-20");
    // 2026-03-21..2026-09-22 = 186 days at 60%, then 179 days at 50%
    expect(weights.get(1)).toBe(6000 * 186 + 5000 * 179);
    expect(weights.get(2)).toBe(4000 * 186 + 5000 * 179);
  });
  it("covers nothing before the first set", () => {
    const { daysCovered } = weightedShares([set("2027-01-01", 10000, 0)], "2026-03-21", "2027-03-20");
    expect(daysCovered).toBe(79);
  });
});

describe("settleGroup", () => {
  it("carries a loss and distributes nothing", () => {
    expect(settleGroup({ groupId: 1, profitToman: -100, lossBeforeToman: 50 })).toMatchObject({ distributableToman: 0, lossAfterToman: 150 });
  });
  it("repays the carried loss before anything reaches the group's shareholders", () => {
    expect(settleGroup({ groupId: 1, profitToman: 300, lossBeforeToman: 100 })).toMatchObject({ repaidToman: 100, distributableToman: 200, lossAfterToman: 0 });
    expect(settleGroup({ groupId: 1, profitToman: 60, lossBeforeToman: 100 })).toMatchObject({ repaidToman: 60, distributableToman: 0, lossAfterToman: 40 });
  });
});

describe("legalReserve", () => {
  it("takes a twentieth until the reserve is a tenth of capital", () => {
    expect(legalReserve(1000, 100_000, 0)).toBe(50);
    expect(legalReserve(1000, 100_000, 9980)).toBe(20); // only 20 of room left
    expect(legalReserve(1000, 100_000, 10_000)).toBe(0);
    expect(legalReserve(0, 100_000, 0)).toBe(0);
    expect(legalReserve(1000, 0, 0)).toBe(0); // no recorded capital, no reserve to fill
  });
});

describe("shareOverhead", () => {
  it("divides by sales and adds up", () => {
    const parts = shareOverhead(1000, new Map([[1, 300], [2, 700]]));
    expect(parts.get(1)).toBe(300);
    expect(parts.get(2)).toBe(700);
    const odd = shareOverhead(100, new Map([[1, 1], [2, 1], [3, 1]]));
    expect([...odd.values()].reduce((t, n) => t + n, 0)).toBe(100);
  });
  it("gives a group with no sales nothing", () => {
    expect(shareOverhead(500, new Map([[1, 0], [2, 100]])).get(1)).toBe(0);
  });
});
