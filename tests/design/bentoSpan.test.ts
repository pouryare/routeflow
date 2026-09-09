import { describe, expect, it } from "vitest";
import { bentoSpanForIndex } from "@/lib/design/bentoSpan";

describe("bentoSpanForIndex", () => {
  it("a lone tile spans full width", () => {
    expect(bentoSpanForIndex(0, 1)).toBe("full");
  });

  it("two tiles pair as wide + narrow", () => {
    expect(bentoSpanForIndex(0, 2)).toBe("wide");
    expect(bentoSpanForIndex(1, 2)).toBe("narrow");
  });

  it("four tiles form two wide+narrow rows", () => {
    expect([0, 1, 2, 3].map((i) => bentoSpanForIndex(i, 4))).toEqual([
      "wide",
      "narrow",
      "wide",
      "narrow",
    ]);
  });

  it("an odd tile left over at the end spans full width, not half", () => {
    expect([0, 1, 2].map((i) => bentoSpanForIndex(i, 3))).toEqual([
      "wide",
      "narrow",
      "full",
    ]);
  });
});
