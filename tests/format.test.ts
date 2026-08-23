import { describe, expect, it } from "vitest";
import { faCount, faDate, faDateTime, faDigits, faFixed, faNum, faToman } from "@/lib/format";

describe("faDigits", () => {
  it("rewrites ASCII digits and leaves everything else alone", () => {
    expect(faDigits("1404/05/12")).toBe("۱۴۰۴/۰۵/۱۲");
    expect(faDigits("کد ۱۲ و 34")).toBe("کد ۱۲ و ۳۴");
  });

  it("does not touch a string with no digits", () => {
    expect(faDigits("بدون عدد")).toBe("بدون عدد");
  });
});

describe("faNum", () => {
  it("groups thousands with the Persian separator", () => {
    expect(faNum(12500)).toBe("۱۲٬۵۰۰");
    expect(faNum(1234567)).toBe("۱٬۲۳۴٬۵۶۷");
  });

  it("returns a dash rather than 'NaN' for a non-finite input", () => {
    // These reach the UI as a division by zero or a missing figure, and "NaN" in the
    // middle of a Persian sentence reads as a crash rather than as absent data.
    expect(faNum(NaN)).toBe("—");
    expect(faNum(Infinity)).toBe("—");
  });
});

describe("faFixed", () => {
  it("uses the Persian decimal separator, not a full stop", () => {
    expect(faFixed(28.14, 1)).toBe("۲۸٫۱");
    expect(faFixed(1, 1)).toBe("۱٫۰");
  });

  it("rounds rather than truncates", () => {
    expect(faFixed(19.36, 1)).toBe("۱۹٫۴");
  });
});

describe("faToman", () => {
  it("rounds to whole تومان and appends the unit", () => {
    expect(faToman(12500.4)).toBe("۱۲٬۵۰۰ تومان");
  });
});

describe("faCount", () => {
  it("joins a number to its unit", () => {
    expect(faCount(45, "روز")).toBe("۴۵ روز");
  });
});

describe("faDateTime", () => {
  it("zero-pads and converts the digits", () => {
    expect(faDateTime("2026-08-22T09:05:00")).toBe("۲۰۲۶/۰۸/۲۲ ۰۹:۰۵");
  });

  it("returns the input unchanged when it is not a date", () => {
    // Better a visibly odd raw value than the string "Invalid Date" in the UI.
    expect(faDateTime("چیزی نیست")).toBe("چیزی نیست");
  });
});

describe("faDate", () => {
  it("drops the time", () => {
    expect(faDate("2026-08-22T09:05:00")).toBe("۲۰۲۶/۰۸/۲۲");
  });
});
