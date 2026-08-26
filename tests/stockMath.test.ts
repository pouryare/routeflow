import { describe, expect, test } from "vitest";
import { movingAverageCost, stockAfter } from "@/lib/stockMath";

describe("movingAverageCost", () => {
  test("is the purchase price when there was no stock", () => {
    expect(movingAverageCost({ onHand: 0, avgCost: 0, qty: 100, unitCost: 3000 })).toBe(3000);
  });

  test("weights the old stock against the new", () => {
    // 100 units at 3000 plus 100 at 5000 averages to 4000.
    expect(movingAverageCost({ onHand: 100, avgCost: 3000, qty: 100, unitCost: 5000 })).toBe(4000);
  });

  test("weights by quantity, not by number of purchases", () => {
    // 900 at 1000 plus 100 at 2000 is 1100, not 1500.
    expect(movingAverageCost({ onHand: 900, avgCost: 1000, qty: 100, unitCost: 2000 })).toBe(1100);
  });

  test("rounds to whole Toman", () => {
    const avg = movingAverageCost({ onHand: 3, avgCost: 1000, qty: 1, unitCost: 1001 });
    expect(Number.isInteger(avg)).toBe(true);
  });

  test("keeps the old average when a receipt has no quantity", () => {
    expect(movingAverageCost({ onHand: 100, avgCost: 3000, qty: 0, unitCost: 9999 })).toBe(3000);
  });

  test("does not let negative stock invert the average", () => {
    // Stock can go negative while paper is still draining. The average must stay the
    // purchase price rather than being pulled through zero into nonsense.
    expect(movingAverageCost({ onHand: -50, avgCost: 3000, qty: 100, unitCost: 5000 })).toBe(5000);
  });

  test("is never negative", () => {
    expect(movingAverageCost({ onHand: 0, avgCost: 0, qty: 10, unitCost: 0 })).toBe(0);
  });
});

describe("stockAfter", () => {
  test("adds what was bought and removes what was delivered", () => {
    expect(stockAfter({ purchased: 500, delivered: 120 })).toBe(380);
  });

  test("goes negative rather than clamping", () => {
    // Deliberate. For months the recorded stock will lag reality while paper drains,
    // and a hard floor would hide that the books are behind rather than show it.
    expect(stockAfter({ purchased: 100, delivered: 250 })).toBe(-150);
  });

  test("is zero when nothing has moved", () => {
    expect(stockAfter({ purchased: 0, delivered: 0 })).toBe(0);
  });
});
