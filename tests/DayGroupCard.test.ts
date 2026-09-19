import { describe, it, expect } from "vitest";
import { faNum } from "@/lib/format";

function makeDay(overrides = {}) {
  return {
    title: "روز ۱",
    stops: [
      { id: 1, name: "Location A", lat: 35.7, lng: 51.4, legKm: 2.5 },
      { id: 2, name: "Location B", lat: 35.71, lng: 51.41, legKm: 1.8 },
    ],
    totalKm: 4.3,
    completed: 1,
    total: 2,
    ...overrides,
  };
}

describe("DayGroupCard logic", () => {
  it("computes progress correctly", () => {
    const day = makeDay({ completed: 1, total: 2 });
    expect(day.completed / day.total).toBe(0.5);
  });

  it("computes progress as 100% when complete", () => {
    const day = makeDay({ completed: 2, total: 2 });
    expect(day.completed / day.total).toBe(1);
  });

  it("shows stop count when totalKm is null", () => {
    const day = makeDay({ totalKm: null });
    expect(day.totalKm).toBeNull();
    expect(day.stops.length).toBe(2);
  });

  it("handles empty stops", () => {
    const day = makeDay({ stops: [] });
    expect(day.stops.length).toBe(0);
  });

  it("uses faNum for stop numbering", () => {
    const day = makeDay();
    expect(faNum(1)).toBe("۱");
    expect(faNum(2)).toBe("۲");
  });

  it("shows distance per stop", () => {
    const day = makeDay();
    expect(day.stops[0].legKm).toBe(2.5);
  });
});
