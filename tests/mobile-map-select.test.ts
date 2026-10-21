import { describe, it, expect } from "vitest";
import { nearestN, toggle, withinRadius } from "@/lib/mapSelect";

const origin = { lat: 35.7, lng: 51.4 };
const pts = [
  { id: 1, lat: 35.71, lng: 51.4 }, // ~1.1 km
  { id: 2, lat: 35.7, lng: 51.4 },  // 0 km
  { id: 3, lat: 35.8, lng: 51.4 },  // ~11 km
  { id: 4, lat: 35.72, lng: 51.4 }, // ~2.2 km
];

describe("map selection helpers", () => {
  it("nearestN returns the closest n ids, nearest first", () => {
    expect(nearestN(pts, origin, 2)).toEqual([2, 1]);
    expect(nearestN(pts, origin, 10)).toEqual([2, 1, 4, 3]);
    expect(nearestN(pts, origin, 0)).toEqual([]);
  });
  it("withinRadius keeps only points inside, nearest first", () => {
    expect(withinRadius(pts, origin, 3)).toEqual([2, 1, 4]);
    expect(withinRadius(pts, origin, 0.5)).toEqual([2]);
    expect(withinRadius(pts, origin, 100)).toHaveLength(4);
  });
  it("toggle adds then removes, without mutating", () => {
    const a = new Set([1]);
    const b = toggle(a, 2);
    expect([...b].sort()).toEqual([1, 2]);
    expect([...a]).toEqual([1]);
    expect([...toggle(b, 1)]).toEqual([2]);
  });
});
