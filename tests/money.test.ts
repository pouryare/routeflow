import { describe, expect, test } from "vitest";
import { toToman, isToman, sumToman, roundToman } from "@/lib/money";

describe("toToman", () => {
  test("reads plain Latin digits", () => {
    expect(toToman("12500")).toBe(12500);
  });

  test("reads Persian digits", () => {
    expect(toToman("۱۲۵۰۰")).toBe(12500);
  });

  test("reads Arabic-Indic digits", () => {
    expect(toToman("١٢٥٠٠")).toBe(12500);
  });

  test("ignores the Persian thousands separator", () => {
    expect(toToman("۱۲٬۵۰۰")).toBe(12500);
  });

  test("ignores Latin thousands separators and spaces", () => {
    expect(toToman("12,500")).toBe(12500);
    expect(toToman(" 12 500 ")).toBe(12500);
  });

  test("rounds a decimal to whole Toman", () => {
    expect(toToman("12500.4")).toBe(12500);
    expect(toToman("12500.6")).toBe(12501);
    expect(toToman("۱۲۵۰۰٫۶")).toBe(12501);
  });

  test("keeps a negative, which is how a reversal is entered", () => {
    expect(toToman("-500")).toBe(-500);
  });

  test("returns null for anything that is not a number", () => {
    expect(toToman("")).toBeNull();
    expect(toToman("   ")).toBeNull();
    expect(toToman("قیمت")).toBeNull();
    expect(toToman("12abc")).toBeNull();
  });
});

describe("isToman", () => {
  test("accepts a whole number", () => {
    expect(isToman(0)).toBe(true);
    expect(isToman(-500)).toBe(true);
    expect(isToman(12500)).toBe(true);
  });

  test("rejects a fraction, which is how REAL money leaks in", () => {
    expect(isToman(12500.5)).toBe(false);
  });

  test("rejects values that are not finite numbers", () => {
    expect(isToman(NaN)).toBe(false);
    expect(isToman(Infinity)).toBe(false);
  });
});

describe("roundToman", () => {
  test("rounds half away from zero, so a reversal mirrors its sale", () => {
    expect(roundToman(0.5)).toBe(1);
    expect(roundToman(-0.5)).toBe(-1);
    expect(roundToman(2.4)).toBe(2);
    expect(roundToman(-2.4)).toBe(-2);
  });
});

describe("sumToman", () => {
  test("adds whole Toman", () => {
    expect(sumToman([12500, 3000, -500])).toBe(15000);
  });

  test("is zero for nothing", () => {
    expect(sumToman([])).toBe(0);
  });

  test("throws on a fractional value rather than absorbing it", () => {
    expect(() => sumToman([100, 0.5])).toThrow(/تومان/);
  });
});
