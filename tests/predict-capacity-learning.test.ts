import { describe, it, expect } from "vitest";
import { observedFactor, ewmaUpdate, blendConfidence } from "@/lib/predict/capacityLearning";

describe("predict/capacityLearning", () => {
  it("observedFactor", () => {
    expect(observedFactor(10, 8)).toBe(0.8);
    expect(observedFactor(10, 13)).toBe(1.3);
    expect(observedFactor(0, 5)).toBeNull();
    expect(observedFactor(-2, 5)).toBeNull();
  });

  it("ewmaUpdate seeds then blends", () => {
    expect(ewmaUpdate(null, 0.8)).toBe(0.8);
    expect(ewmaUpdate(undefined, 0.8)).toBe(0.8);
    expect(ewmaUpdate(1, 0.8, 0.5)).toBeCloseTo(0.9, 9);
    expect(ewmaUpdate(1, 0.8, 0.25)).toBeCloseTo(0.95, 9);
  });

  it("blendConfidence ramps 0→1 over `full` observations", () => {
    expect(blendConfidence(0)).toBe(0);
    expect(blendConfidence(5)).toBe(0.5);
    expect(blendConfidence(10)).toBe(1);
    expect(blendConfidence(50)).toBe(1);
  });
});
