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

  it("agrees with the substrate spec's published figures", () => {
    // --text on --bg / --surface, light -- the 2026-09-08 cool+black repalette.
    expect(contrastRatio("#16181D", "#ECEDEF")).toBeCloseTo(15.16, 1);
    expect(contrastRatio("#16181D", "#FFFFFF")).toBeCloseTo(17.76, 1);
    // --primary-ink on --primary, light: the near-black primary pill clears AAA easily.
    expect(contrastRatio("#FFFFFF", "#101216")).toBeCloseTo(18.75, 1);
  });
});
