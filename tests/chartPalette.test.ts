import { readFileSync } from "node:fs";
import path from "node:path";
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
    // The palette moved behind CSS variables so a theme change re-colours every chart
    // without re-rendering it, but the property this test defends did not move: the
    // ordering is what was validated, and reordering it is not a cosmetic change. An
    // earlier attempt to lead with the app's cyan accent collapsed green against magenta
    // to a deuteranopia distance of 1.6 -- two series a red-green colourblind reader
    // cannot tell apart. So the indirection is checked here and the literals below.
    expect(SERIES_COLORS).toEqual([
      "var(--series-1)",
      "var(--series-2)",
      "var(--series-3)",
      "var(--series-4)",
      "var(--series-5)",
      "var(--series-6)",
      "var(--series-7)",
    ]);
  });

  test("resolves to the validated hexes, in both themes", () => {
    // Reads the stylesheet rather than trusting it. Without this the test above only
    // proves the variables are referenced in order -- it would pass just as happily if
    // someone edited globals.css and swapped two hues, which is exactly the edit the
    // original version of this test existed to catch.
    const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
    const setAt = (from: number) =>
      Array.from({ length: 7 }, (_, i) => {
        const m = css.slice(from).match(new RegExp(`--series-${i + 1}:\\s*(#[0-9a-f]{6})`, "i"));
        return m?.[1].toLowerCase();
      });

    // Light is the default (2026-09-08 substrate redesign) and comes first in the file
    // at bare :root; dark is the explicit :root[data-theme="dark"] block further down.
    // This inverts the file's structure from before the redesign, when dark was the
    // unscoped default and light was the marked-off exception -- the search order below
    // is inverted to match, not the palette itself.
    // The bare attribute-selector STRING appears earlier too, inside prose comments
    // describing the dark block before the block itself -- match the rule's opening
    // brace specifically, or an early comment mention is found instead of the real rule.
    const darkAt = css.indexOf(':root[data-theme="dark"] {');
    expect(darkAt).toBeGreaterThan(-1);

    // Light: the default. Searched to meet the same 7.9 deuteranopia/protanopia figure
    // as dark rather than a looser one. Bright cyan is absent for the same reason it is
    // absent from the dark categorical order -- it is a single-series colour, not a
    // categorical one.
    expect(setAt(0)).toEqual([
      "#0068cb", "#b63e00", "#018058", "#9c6600", "#ac0258", "#008d00", "#6a3fe9",
    ]);

    // Dark: the original validated order. Worst adjacent separation 7.9, yellow against
    // magenta under deuteranopia.
    expect(setAt(darkAt)).toEqual([
      "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9",
    ]);
  });

  test("assigns by position, so a colour follows a series and not its rank", () => {
    expect(seriesColor(0)).toBe("var(--series-1)");
    expect(seriesColor(2)).toBe("var(--series-3)");
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
