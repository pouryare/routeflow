import { describe, it, expect } from "vitest";
import { moveItem, slotAt } from "@/lib/reorder";

describe("reordering a list by dragging", () => {
  it("moves an item down and up without mutating the original", () => {
    const a = ["a", "b", "c", "d"];
    expect(moveItem(a, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(a, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(a).toEqual(["a", "b", "c", "d"]);
  });
  it("a no-op or out-of-range move leaves the order alone", () => {
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 5, 0)).toEqual([1, 2, 3]);
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
  it("the slot under the pointer is the first row whose midpoint is below it", () => {
    const mids = [20, 60, 100];
    expect(slotAt(mids, 10)).toBe(0);
    expect(slotAt(mids, 50)).toBe(1);
    expect(slotAt(mids, 70)).toBe(2);
    expect(slotAt(mids, 500)).toBe(2);
    expect(slotAt([], 5)).toBe(0);
  });
});
