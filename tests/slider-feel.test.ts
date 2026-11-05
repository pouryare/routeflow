// AmountSlider: notches and the rubber end.
import { describe, expect, it } from "vitest";
import { edgeOvershoot, tickStops } from "@/lib/sliderFeel";

describe("edgeOvershoot", () => {
  it("is 0 on the track and signed past either end", () => {
    expect(edgeOvershoot(50, 10, 110)).toBe(0);
    expect(edgeOvershoot(4, 10, 110)).toBe(-6);
    expect(edgeOvershoot(130, 10, 110)).toBe(20);
  });
});

describe("tickStops", () => {
  it("puts one notch per step, ends included", () => {
    expect(tickStops(0, 30, 5)).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]);
  });
  it("gives nothing for a broken range", () => {
    expect(tickStops(5, 5, 1)).toEqual([]);
    expect(tickStops(0, 10, 0)).toEqual([]);
  });
});
