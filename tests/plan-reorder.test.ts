import { describe, expect, it } from "vitest";
import { reorderPatches } from "@/lib/planReorder";

const plans = [
  { id: 10, sort_order: 0 },
  { id: 11, sort_order: 1 },
  { id: 12, sort_order: 2 },
];

describe("reorderPatches", () => {
  it("changes nothing when the order is the same", () => {
    expect(reorderPatches(plans, [10, 11, 12])).toEqual([]);
  });
  it("moving the last stop to the top shifts everyone", () => {
    expect(reorderPatches(plans, [12, 10, 11])).toEqual([
      { id: 12, sort_order: 0 },
      { id: 10, sort_order: 1 },
      { id: 11, sort_order: 2 },
    ]);
  });
  it("only the two swapped stops change", () => {
    expect(reorderPatches(plans, [11, 10, 12])).toEqual([
      { id: 11, sort_order: 0 },
      { id: 10, sort_order: 1 },
    ]);
  });
  it("renumbers a day whose orders are all the same", () => {
    const flat = [{ id: 1, sort_order: 0 }, { id: 2, sort_order: 0 }];
    expect(reorderPatches(flat, [2, 1])).toEqual([{ id: 2, sort_order: 1 }, { id: 1, sort_order: 2 }]);
  });
});
