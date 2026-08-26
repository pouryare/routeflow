import { describe, expect, test } from "vitest";
import {
  SERIES_COLORS,
  seriesColor,
  OTHER_COLOR,
  SINGLE_SERIES_COLOR,
  foldTail,
} from "@/lib/chartPalette";

describe("the categorical palette", () => {
  test("is the exact order that was validated, in that order", () => {
    // These seven hues and this ordering passed the colour-blindness, lightness,
    // chroma and contrast checks against this app's chart surface (#121a24).
    // Reordering them is not a cosmetic change -- an earlier attempt to lead with the
    // app's cyan accent collapsed green against magenta to a deuteranopia distance of
    // 1.6, meaning a red-green colourblind reader could not tell two series apart.
    expect(SERIES_COLORS).toEqual([
      "#3987e5",
      "#d95926",
      "#199e70",
      "#c98500",
      "#d55181",
      "#008300",
      "#9085e9",
    ]);
  });

  test("assigns by position, so a colour follows a series and not its rank", () => {
    expect(seriesColor(0)).toBe("#3987e5");
    expect(seriesColor(2)).toBe("#199e70");
  });

  test("folds an eighth series into Other rather than inventing a hue", () => {
    // Cycling back to slot 1 would give two series the same colour, which is worse
    // than admitting the chart has run out of room.
    expect(seriesColor(7)).toBe(OTHER_COLOR);
    expect(seriesColor(99)).toBe(OTHER_COLOR);
  });

  test("keeps the single-series colour out of the categorical order", () => {
    // The brand cyan is too light for a categorical slot (L 0.83 against a band of
    // 0.48-0.67). It is only ever used where there is exactly one series and so
    // nothing to be confused with.
    expect(SERIES_COLORS).not.toContain(SINGLE_SERIES_COLOR);
  });

  test("never uses a reserved status colour as a series colour", () => {
    // good / warn / crit mean something on this map. A series painted --crit reads as
    // an alert rather than as a category.
    for (const status of ["#3ddc84", "#f5a623", "#f0475b"]) {
      expect(SERIES_COLORS).not.toContain(status);
    }
  });
});

describe("foldTail", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `p${i}`, total: (n - i) * 10 }));
  const fold = (n: number) =>
    foldTail(
      rows(n),
      (r) => r.total,
      (r) => r.name
    );

  test("leaves a list that already fits", () => {
    const out = fold(5);
    expect(out).toHaveLength(5);
    expect(out.every((r) => !r.isOther)).toBe(true);
  });

  test("leaves a list of exactly the maximum untouched", () => {
    expect(fold(7)).toHaveLength(7);
    expect(fold(7).some((r) => r.isOther)).toBe(false);
  });

  test("folds anything longer down to the maximum", () => {
    const out = fold(12);
    expect(out).toHaveLength(7);
    expect(out[6].isOther).toBe(true);
    expect(out[6].label).toBe("سایر");
  });

  test("keeps the total, so the folded chart still adds up", () => {
    const before = rows(12).reduce((a, r) => a + r.total, 0);
    const after = fold(12).reduce((a, r) => a + r.value, 0);
    expect(after).toBe(before);
  });

  test("is empty for no rows", () => {
    expect(fold(0)).toEqual([]);
  });
});
