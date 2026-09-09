import { describe, it, expect } from "vitest";
import { parseHex, relativeLuminance, contrastRatio } from "@/lib/design/contrast";

describe("contrast", () => {
  it("parses 6-digit hex with and without the hash", () => {
    expect(parseHex("#FFFFFF")).toEqual([255, 255, 255]);
    expect(parseHex("000000")).toEqual([0, 0, 0]);
  });

  it("rejects anything that is not a 6-digit hex", () => {
    expect(() => parseHex("#fff")).toThrow();
    expect(() => parseHex("rebeccapurple")).toThrow();
  });

  it("computes the WCAG reference luminances", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });

  it("gives 21:1 for black on white, and is symmetric", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 2);
  });

  it("agrees with the figures MASTER.md publishes", () => {
    expect(contrastRatio("#231C16", "#F4F0E9")).toBeCloseTo(14.8, 1);
    expect(contrastRatio("#241009", "#E8734A")).toBeCloseTo(6.06, 1);
    // the two failures that shaped the palette
    expect(contrastRatio("#C0532B", "#F4F0E9")).toBeLessThan(4.5);
    expect(contrastRatio("#FFFFFF", "#E8734A")).toBeLessThan(4.5);
  });
});
