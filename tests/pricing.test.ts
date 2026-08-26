import { describe, expect, test } from "vitest";
import { priceAt, priceHistory, type PriceRow } from "@/lib/pricing";

const row = (id: number, price: number, valid_from: string): PriceRow => ({
  id,
  price_toman: price,
  valid_from,
});

describe("priceAt", () => {
  test("returns the only price when there is one", () => {
    expect(priceAt([row(1, 440000, "2026-01-01")], "2026-08-26")?.price_toman).toBe(440000);
  });

  test("returns the most recent price that had started", () => {
    const rows = [
      row(1, 400000, "2026-01-01"),
      row(2, 440000, "2026-05-01"),
      row(3, 528000, "2026-09-01"),
    ];
    expect(priceAt(rows, "2026-08-26")?.price_toman).toBe(440000);
  });

  test("includes the day the price starts", () => {
    const rows = [row(1, 400000, "2026-01-01"), row(2, 440000, "2026-05-01")];
    expect(priceAt(rows, "2026-05-01")?.price_toman).toBe(440000);
  });

  test("ignores a price that has not started yet", () => {
    // Entering next month's price early must not reprice today's orders. This is the
    // whole reason prices are rows rather than a column.
    const rows = [row(1, 440000, "2026-01-01"), row(2, 528000, "2026-12-01")];
    expect(priceAt(rows, "2026-08-26")?.price_toman).toBe(440000);
  });

  test("returns null before any price existed", () => {
    expect(priceAt([row(1, 440000, "2026-05-01")], "2026-01-01")).toBeNull();
  });

  test("returns null when there are no prices at all", () => {
    expect(priceAt([], "2026-08-26")).toBeNull();
  });

  test("does not depend on the order rows arrive in", () => {
    const ordered = [row(1, 400000, "2026-01-01"), row(2, 440000, "2026-05-01")];
    const shuffled = [ordered[1], ordered[0]];
    expect(priceAt(shuffled, "2026-08-26")?.id).toBe(priceAt(ordered, "2026-08-26")?.id);
  });

  test("prefers the later row when two share a start date", () => {
    // A price corrected on the day it was entered. The second row is the correction,
    // and taking the first would quietly keep the typo.
    const rows = [row(1, 44000, "2026-05-01"), row(2, 440000, "2026-05-01")];
    expect(priceAt(rows, "2026-08-26")?.price_toman).toBe(440000);
  });

  test("resolves against a full timestamp as well as a bare date", () => {
    const rows = [row(1, 440000, "2026-05-01")];
    expect(priceAt(rows, "2026-08-26T09:30:00.000Z")?.price_toman).toBe(440000);
  });

  test("returns the row itself, so the order line can record which price it used", () => {
    const rows = [row(7, 440000, "2026-05-01")];
    expect(priceAt(rows, "2026-08-26")?.id).toBe(7);
  });
});

describe("priceHistory", () => {
  test("puts the newest price first", () => {
    const rows = [
      row(1, 400000, "2026-01-01"),
      row(3, 528000, "2026-09-01"),
      row(2, 440000, "2026-05-01"),
    ];
    expect(priceHistory(rows).map((r) => r.id)).toEqual([3, 2, 1]);
  });

  test("puts the correction above the row it corrects on a shared date", () => {
    const rows = [row(1, 44000, "2026-05-01"), row(2, 440000, "2026-05-01")];
    expect(priceHistory(rows).map((r) => r.id)).toEqual([2, 1]);
  });

  test("does not mutate the caller's array", () => {
    const rows = [row(1, 400000, "2026-01-01"), row(2, 440000, "2026-05-01")];
    priceHistory(rows);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  test("is empty for no prices", () => {
    expect(priceHistory([])).toEqual([]);
  });
});
