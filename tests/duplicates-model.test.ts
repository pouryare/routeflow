import { describe, it, expect } from "vitest";
import { chooseSurvivor, pairKey } from "@/lib/duplicates";

describe("duplicate customers: which record survives", () => {
  it("the one with more orders", () => {
    const r = chooseSurvivor({ id: 9, orders: 2, lastActivity: "" }, { id: 3, orders: 7, lastActivity: "" });
    expect(r.keep.id).toBe(3);
    expect(r.drop.id).toBe(9);
  });
  it("then the more recently touched, then the older record", () => {
    expect(chooseSurvivor({ id: 1, orders: 4, lastActivity: "2026-01-01" }, { id: 2, orders: 4, lastActivity: "2026-06-01" }).keep.id).toBe(2);
    expect(chooseSurvivor({ id: 5, orders: 0, lastActivity: "" }, { id: 4, orders: 0, lastActivity: "" }).keep.id).toBe(4);
  });
  it("a pair is the same pair whichever way round it is written", () => {
    expect(pairKey(8, 3)).toEqual([3, 8]);
    expect(pairKey(3, 8)).toEqual([3, 8]);
  });
});
