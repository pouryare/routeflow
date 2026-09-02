import { describe, it, expect } from "vitest";
import { reorderPoint, stockDays, inventoryState } from "@/lib/predict/inventory";

describe("predict/inventory", () => {
  it("reorderPoint = avg_daily × lead_time + safety", () => {
    expect(reorderPoint(4, 3, 10)).toBe(22);
  });

  it("stockDays, infinite when nothing sells", () => {
    expect(stockDays(100, 5)).toBe(20);
    expect(stockDays(100, 0)).toBe(Infinity);
  });

  it("inventoryState hits every branch", () => {
    // dead: stock but no sale in 60+ days
    expect(inventoryState(100, 0.1, 5, 90)).toBe("dead");
    // stockout risk: nothing available
    expect(inventoryState(0, 5, 20, 3)).toBe("stockout_risk");
    // stockout risk: well below reorder
    expect(inventoryState(4, 5, 20, 3)).toBe("stockout_risk");
    // low: below reorder but above half
    expect(inventoryState(15, 5, 20, 3)).toBe("low");
    // overstock: 60+ days of cover
    expect(inventoryState(1000, 5, 20, 10)).toBe("overstock");
    // healthy
    expect(inventoryState(60, 5, 20, 5)).toBe("healthy");
  });
});
