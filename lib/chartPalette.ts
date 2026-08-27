/** Series colours for the dashboards.
 *
 *  Each entry is a CSS variable, defined once per theme in globals.css, so switching
 *  theme re-colours every chart without re-rendering it. The literal values live there;
 *  the hexes in the comments below are for reference when re-running the validator.
 *
 *  This list is not a matter of taste and must not be reordered or extended by eye. It
 *  was checked with a validator against this app's chart surface (#121a24) for five
 *  things: that every hue sits in the lightness band a dark surface needs, that none is
 *  too grey to read as a colour, that adjacent pairs stay apart under protanopia,
 *  deuteranopia and tritanopia, that they stay apart for normal vision too, and that each
 *  clears 3:1 contrast against the background.
 *
 *  Two things were tried first and failed, which is why the comment is this long:
 *
 *  1. Leading with the app's own accent (#2DE0E6) fails the lightness band outright --
 *     that cyan is L 0.83 against a band of 0.48-0.67. It is a superb accent and a bad
 *     fill: as a large area on a dark surface it glares, and it leaves no headroom for a
 *     hover or selected state.
 *  2. Reordering the remaining hues to put the cyan first dropped the green/magenta pair
 *     to a deuteranopia distance of 1.6 -- indistinguishable to a red-green colourblind
 *     reader. The order below is part of what was validated, not an arrangement of it.
 *
 *  So the brand cyan is used where there is exactly one series and therefore nothing to
 *  confuse it with, and the categorical order is used untouched everywhere else.
 */

/** The validated categorical order. Assign by position; never cycle. */
export const SERIES_COLORS = [
  "var(--series-1)", // blue    dark #3987e5 · light #0068cb
  "var(--series-2)", // orange  dark #d95926 · light #b63e00
  "var(--series-3)", // aqua    dark #199e70 · light #018058
  "var(--series-4)", // yellow  dark #c98500 · light #9c6600
  "var(--series-5)", // magenta dark #d55181 · light #ac0258
  "var(--series-6)", // green   dark #008300 · light #008d00
  "var(--series-7)", // violet  dark #9085e9 · light #6a3fe9
] as const;

/** One series, so nothing to be told apart from: the chart wears the app's accent. */
export const SINGLE_SERIES_COLOR = "var(--series-single)";

/** Everything past the seventh series. A cycled palette gives two categories the same
 *  colour, which is a quieter and worse failure than a chart that says it ran out of
 *  room -- so the caller is expected to group the tail under «سایر». */
export const OTHER_COLOR = "var(--series-other)";

export function seriesColor(index: number): string {
  return SERIES_COLORS[index] ?? OTHER_COLOR;
}

/** The most series that can be drawn before the tail has to be folded into «سایر». */
export const MAX_SERIES = SERIES_COLORS.length;

export interface FoldedSlice {
  label: string;
  value: number;
  isOther: boolean;
}

/** Caps a series list at MAX_SERIES by summing everything past it into one «سایر».
 *
 *  Expects the list already sorted by whatever makes the tail the least interesting --
 *  usually descending value. The total is preserved, so a folded pie still adds to the
 *  same number as the table beneath it, which is the property that makes the fold safe
 *  to apply without a footnote. */
export function foldTail<T>(
  items: T[],
  value: (item: T) => number,
  label: (item: T) => string
): FoldedSlice[] {
  const mapped = items.map((i) => ({ label: label(i), value: value(i), isOther: false }));
  if (mapped.length <= MAX_SERIES) return mapped;

  const head = mapped.slice(0, MAX_SERIES - 1);
  head.push({
    label: "سایر",
    value: mapped.slice(MAX_SERIES - 1).reduce((a, x) => a + x.value, 0),
    isOther: true,
  });
  return head;
}
