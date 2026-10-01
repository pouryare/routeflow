import { describe, expect, test } from "vitest";
import { toPercent } from "@/lib/margin/percent";

describe("toPercent", () => {
  test("keeps a decimal instead of rounding it away", () => {
    // The whole reason this module exists. toToman("2.5") is 3, which is correct for
    // money and wrong for a rate.
    expect(toPercent("2.5")).toBe(2.5);
    expect(toPercent("0.5")).toBe(0.5);
  });

  test("reads Persian digits and the Persian decimal separator", () => {
    expect(toPercent("۲٫۵")).toBe(2.5);
    expect(toPercent("۱۰")).toBe(10);
    expect(toPercent("۰")).toBe(0);
  });

  test("accepts a Latin decimal point alongside grouping separators", () => {
    expect(toPercent("2.5")).toBe(2.5);
    expect(toPercent("12.25")).toBe(12.25);
    // Grouping is stripped before the cap is applied, so a pasted figure is read as the
    // number it is. 1234.5% is not a rate, so it is refused -- but for being over 100,
    // not for containing a comma.
    expect(toPercent("1,234.5")).toBeNull();
    expect(toPercent("12.5")).toBe(12.5);
  });

  test("distinguishes an absent field from a measured zero", () => {
    expect(toPercent("0")).toBe(0);
    expect(toPercent("")).toBeNull();
    expect(toPercent("   ")).toBeNull();
  });

  test("returns null on anything that is not a number", () => {
    expect(toPercent("abc")).toBeNull();
    expect(toPercent("٪")).toBeNull();
    expect(toPercent("2.5.5")).toBeNull();
  });

  test("keeps at most two decimal places", () => {
    expect(toPercent("2.555")).toBe(2.56);
    expect(toPercent("2.554")).toBe(2.55);
  });

  test("refuses a negative rate", () => {
    expect(toPercent("-3")).toBeNull();
  });

  test("caps at 100 so one field cannot claim more than the whole", () => {
    expect(toPercent("140")).toBeNull();
    expect(toPercent("100")).toBe(100);
  });
});
