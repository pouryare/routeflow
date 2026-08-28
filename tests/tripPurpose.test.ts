import { describe, expect, test } from "vitest";
import { TRIP_PURPOSES, isTripPurpose, tripPurpose } from "@/lib/tripPurpose";

describe("trip purposes", () => {
  test("the four kinds this business does, each with its own identity", () => {
    expect(TRIP_PURPOSES.map((p) => p.id)).toEqual([
      "first_visit",
      "sample",
      "delivery",
      "collect",
    ]);
  });

  test("every purpose is distinguishable by colour, not only by label", () => {
    const inks = new Set(TRIP_PURPOSES.map((p) => p.ink));
    const softs = new Set(TRIP_PURPOSES.map((p) => p.soft));
    expect(inks.size).toBe(TRIP_PURPOSES.length);
    expect(softs.size).toBe(TRIP_PURPOSES.length);
  });

  test("colour is never the ONLY carrier — each has a glyph and a label too", () => {
    for (const p of TRIP_PURPOSES) {
      expect(p.icon.length).toBeGreaterThan(0);
      expect(p.label.length).toBeGreaterThan(3);
    }
  });

  test("an unknown or missing purpose stays unknown", () => {
    // The column is nullable, and rows written before it existed have no answer.
    // Falling back to the first purpose would relabel every historic visit.
    expect(tripPurpose(null)).toBeNull();
    expect(tripPurpose(undefined)).toBeNull();
    expect(tripPurpose("something-else")).toBeNull();
    expect(isTripPurpose("delivery")).toBe(true);
    expect(isTripPurpose("")).toBe(false);
  });

  test("a stored value resolves to its own definition", () => {
    expect(tripPurpose("collect")?.label).toBe("پول گرفتن");
    expect(tripPurpose("delivery")?.label).toBe("بار بردن");
  });
});
