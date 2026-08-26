import { describe, expect, test } from "vitest";
import { effectiveAt } from "@/lib/pricing";
import { rateFor, accrualToman, type RateRow } from "@/lib/commission";

const rate = (
  id: number,
  perKg: number,
  validFrom: string,
  salesperson: number | null = null,
  urgent: number | null = null
): RateRow => ({
  id,
  salesperson_user_id: salesperson,
  rate_per_kg_toman: perKg,
  urgent_rate_per_kg_toman: urgent,
  valid_from: validFrom,
});

describe("effectiveAt", () => {
  const rows = [
    { id: 1, valid_from: "2026-01-01" },
    { id: 2, valid_from: "2026-05-01" },
    { id: 3, valid_from: "2026-09-01" },
  ];

  test("returns the most recent row that had started", () => {
    expect(effectiveAt(rows, "2026-08-26")?.id).toBe(2);
  });

  test("includes the day a row starts", () => {
    expect(effectiveAt(rows, "2026-05-01")?.id).toBe(2);
  });

  test("ignores a row that has not started", () => {
    expect(effectiveAt(rows, "2026-02-01")?.id).toBe(1);
  });

  test("returns null before anything applied", () => {
    expect(effectiveAt(rows, "2025-01-01")).toBeNull();
  });

  test("prefers the later row when two share a date", () => {
    const tied = [
      { id: 5, valid_from: "2026-05-01" },
      { id: 6, valid_from: "2026-05-01" },
    ];
    expect(effectiveAt(tied, "2026-08-01")?.id).toBe(6);
  });

  test("does not depend on the order rows arrive in", () => {
    expect(effectiveAt([...rows].reverse(), "2026-08-26")?.id).toBe(2);
  });

  test("is empty-safe", () => {
    expect(effectiveAt([], "2026-08-26")).toBeNull();
  });
});

describe("rateFor", () => {
  const rows = [
    rate(1, 2000, "2026-01-01"), // company default
    rate(2, 2500, "2026-06-01"), // default goes up
    rate(3, 3000, "2026-06-01", 7), // نازنین negotiated her own
  ];

  test("uses the company default when a person has no rate of their own", () => {
    expect(rateFor(rows, 9, "2026-08-26")?.rate_per_kg_toman).toBe(2500);
  });

  test("prefers a rate set for that person", () => {
    expect(rateFor(rows, 7, "2026-08-26")?.rate_per_kg_toman).toBe(3000);
  });

  test("falls back to the default before the personal rate started", () => {
    // Her own rate begins in Khordad. Before that she is on the company rate, not on
    // no rate at all.
    expect(rateFor(rows, 7, "2026-02-01")?.rate_per_kg_toman).toBe(2000);
  });

  test("returns null when no rate has ever been set", () => {
    expect(rateFor([], 7, "2026-08-26")).toBeNull();
  });

  test("returns null for a date before any rate existed", () => {
    expect(rateFor(rows, 7, "2025-01-01")).toBeNull();
  });

  test("handles an order with nobody credited to it", () => {
    // A manager can record an order without naming a فروشنده. It earns the company
    // rate for reporting, and pays nobody.
    expect(rateFor(rows, null, "2026-08-26")?.rate_per_kg_toman).toBe(2500);
  });
});

describe("accrualToman", () => {
  test("is kilograms times the rate", () => {
    expect(accrualToman(50, 2500)).toBe(125000);
  });

  test("rounds a fractional weight to whole Toman", () => {
    expect(accrualToman(5.4, 2500)).toBe(13500);
    expect(accrualToman(1 / 3, 100)).toBe(33);
  });

  test("is negative for a returned line, so a return claws the commission back", () => {
    expect(accrualToman(-50, 2500)).toBe(-125000);
  });

  test("mirrors exactly when reversed", () => {
    expect(accrualToman(5.4, 2501) + accrualToman(-5.4, 2501)).toBe(0);
  });

  test("is zero for no weight", () => {
    expect(accrualToman(0, 2500)).toBe(0);
  });

  test("is always a whole number", () => {
    for (const kg of [0.1, 1 / 3, 2 / 7, 1.05]) {
      expect(Number.isInteger(accrualToman(kg, 2500))).toBe(true);
    }
  });
});
