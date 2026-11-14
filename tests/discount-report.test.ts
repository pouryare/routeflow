import { describe, it, expect } from "vitest";
import { discountReport } from "@/lib/discountReport";

describe("discountReport", () => {
  it("groups by rep and customer and shares an order's discount among products by line value", () => {
    const r = discountReport([
      { amount: 300_000, rep: "علی", customer: "الف", how: "approved", lines: [{ product: "برنج", value: 600_000 }, { product: "روغن", value: 400_000 }] },
      { amount: 50_000, rep: "علی", customer: "ب", how: "auto", lines: [{ product: "برنج", value: 100_000 }] },
    ]);
    expect(r.total).toBe(350_000);
    expect([r.autoCount, r.approvedCount]).toEqual([1, 1]);
    expect(r.byRep).toEqual([{ name: "علی", amount: 350_000 }]);
    expect(r.byProduct).toEqual([{ name: "برنج", amount: 230_000 }, { name: "روغن", amount: 120_000 }]);
  });
  it("an order without lines still counts in the total", () => {
    expect(discountReport([{ amount: 10, rep: "x", customer: "y", how: "auto", lines: [] }]).total).toBe(10);
  });
});
