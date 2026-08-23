import { describe, it, expect } from "vitest";
import { distanceKm, formatDistanceKm, nearestNeighborOrder } from "@/lib/geo";

describe("distanceKm", () => {
  it("is ~0 for the same point", () => {
    expect(distanceKm({ lat: 35.7, lng: 51.4 }, { lat: 35.7, lng: 51.4 })).toBeCloseTo(0, 5);
  });

  it("matches the known straight-line distance between Tehran and Damavand city", () => {
    const tehran = { lat: 35.6892, lng: 51.389 };
    const damavand = { lat: 35.7178, lng: 52.0658 };
    const km = distanceKm(tehran, damavand);
    expect(km).toBeGreaterThan(55);
    expect(km).toBeLessThan(70);
  });

  it("is symmetric", () => {
    const a = { lat: 35.7, lng: 51.4 };
    const b = { lat: 35.75, lng: 51.5 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 10);
  });
});

describe("nearestNeighborOrder", () => {
  it("visits the closest unvisited stop next, starting from the given point", () => {
    const stops = [
      { id: "far", lat: 10, lng: 10 },
      { id: "near", lat: 0.01, lng: 0.01 },
      { id: "mid", lat: 1, lng: 1 },
    ];
    const ordered = nearestNeighborOrder(stops, { lat: 0, lng: 0 });
    expect(ordered.map((s) => s.id)).toEqual(["near", "mid", "far"]);
  });

  it("starts from the first stop when no starting point is given", () => {
    const stops = [
      { id: "a", lat: 0, lng: 0 },
      { id: "b", lat: 5, lng: 5 },
      { id: "c", lat: 0.1, lng: 0.1 },
    ];
    const ordered = nearestNeighborOrder(stops, null);
    expect(ordered).toHaveLength(3);
    expect(ordered[0].id).toBe("a");
    // after "a", "c" (close to a) should come before the distant "b"
    expect(ordered[1].id).toBe("c");
  });

  it("preserves every stop exactly once", () => {
    const stops = Array.from({ length: 8 }, (_, i) => ({ id: i, lat: Math.random() * 10, lng: Math.random() * 10 }));
    const ordered = nearestNeighborOrder(stops, { lat: 5, lng: 5 });
    expect(new Set(ordered.map((s) => s.id))).toEqual(new Set(stops.map((s) => s.id)));
  });

  it("handles an empty stop list", () => {
    expect(nearestNeighborOrder([], { lat: 0, lng: 0 })).toEqual([]);
  });
});

describe("formatDistanceKm", () => {
  it("switches to metres below one kilometre, where a decimal km reads as false precision", () => {
    expect(formatDistanceKm(0.42)).toBe("420 متر");
    expect(formatDistanceKm(0.999)).toBe("999 متر");
  });

  it("uses one decimal kilometre above that", () => {
    expect(formatDistanceKm(1)).toBe("1.0 کیلومتر");
    expect(formatDistanceKm(28.14)).toBe("28.1 کیلومتر");
  });
})
