import { describe, it, expect } from "vitest";
import { quantitiesOn } from "@/lib/stockOnDate";

describe("D9 stock on a past day", () => {
  const moves = [
    { productId: 1, baseQty: 100, occurredAt: "2026-01-01T09:00:00Z" },
    { productId: 1, baseQty: -30, occurredAt: "2026-01-05T09:00:00Z" },
    { productId: 2, baseQty: 5, occurredAt: "2026-01-02T09:00:00Z" },
  ];
  it("sums what had moved by the end of the day", () => {
    expect(quantitiesOn(moves, "2026-01-03").get(1)).toBe(100);
    expect(quantitiesOn(moves, "2026-01-05").get(1)).toBe(70);
    expect(quantitiesOn(moves, "2025-12-31").size).toBe(0);
  });
});
