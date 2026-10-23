import { describe, it, expect } from "vitest";
import { customerProductIds } from "@/lib/customerProducts";

describe("customerProductIds (F62)", () => {
  it("puts the usual basket first, then the rest of what the shop bought, without repeats", () => {
    expect(customerProductIds([{ product_id: 3 }, { product_id: 1 }], [{ product_id: 1 }, { product_id: 7 }, { product_id: 3 }]))
      .toEqual(["3", "1", "7"]);
  });
  it("is capped so the shortcut row stays short", () => {
    const mix = Array.from({ length: 20 }, (_, i) => ({ product_id: i + 1 }));
    expect(customerProductIds([], mix, 8)).toHaveLength(8);
  });
  it("a shop with no history pins nothing", () => {
    expect(customerProductIds([], [])).toEqual([]);
  });
});
