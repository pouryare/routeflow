import { describe, it, expect } from "vitest";
import { hexBins, hexPolygon, hexSteps, isHexRes } from "@/lib/h3";

describe("hexagon grid", () => {
  it("groups nearby points into one cell and keeps far ones apart, summing weights", () => {
    const cells = hexBins([
      { lat: 35.7000, lng: 51.4000, weight: 1000 },
      { lat: 35.7001, lng: 51.4001, weight: 500 },
      { lat: 35.8000, lng: 51.5000, weight: 70 },
    ]);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ count: 2, value: 1500 }); // biggest first
    expect(cells[1]).toMatchObject({ count: 1, value: 70 });
  });
  it("counts 1 per point when no weight is given", () => {
    expect(hexBins([{ lat: 35.7, lng: 51.4 }, { lat: 35.7, lng: 51.4 }])[0]).toMatchObject({ count: 2, value: 2 });
  });
  it("drops points that are not on the earth instead of throwing", () => {
    expect(hexBins([{ lat: NaN, lng: 51 }, { lat: 120, lng: 51 }, { lat: 35.7, lng: 51.4 }])).toHaveLength(1);
  });
  it("a cell's polygon is a closed ring of six corners", () => {
    const [cell] = hexBins([{ lat: 35.7, lng: 51.4 }]);
    const ring = hexPolygon(cell.h3).coordinates[0];
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual(ring[6]);
    expect(ring[0][0]).toBeGreaterThan(50); // longitude first
  });
  it("colour steps follow rank, so one very busy cell does not wash out the rest", () => {
    expect(hexSteps([1, 2, 3, 4, 1_000_000])).toEqual([0, 1, 2, 3, 4]);
    expect(hexSteps([])).toEqual([]);
  });
  it("only the two offered sizes are accepted", () => {
    expect(isHexRes(8)).toBe(true);
    expect(isHexRes(15)).toBe(false);
  });
});
