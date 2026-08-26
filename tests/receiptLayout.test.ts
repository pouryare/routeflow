import { describe, expect, test } from "vitest";
import { wrapText, truncateToWidth } from "@/lib/receiptLayout";

/** Stands in for ctx.measureText: every character is six units wide. */
const measure = (s: string) => s.length * 6;

describe("wrapText", () => {
  test("leaves a line that already fits", () => {
    expect(wrapText(measure, "کره گیاهی", 200)).toEqual(["کره گیاهی"]);
  });

  test("breaks on spaces rather than mid-word", () => {
    // A thermal receipt is 384 dots wide and Persian product names are long. Breaking
    // inside a word puts an unjoined fragment at the end of a line, which in Persian
    // renders as a different letterform and reads as a typo.
    const lines = wrapText(measure, "کره گیاهی مرحبا جعبه بچه", 60);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => !l.startsWith(" ") && !l.endsWith(" "))).toBe(true);
  });

  test("never exceeds the width it is given", () => {
    for (const line of wrapText(measure, "یک دو سه چهار پنج شش هفت هشت نه ده", 60)) {
      expect(measure(line)).toBeLessThanOrEqual(60);
    }
  });

  test("breaks a single word that cannot fit at all", () => {
    // Otherwise one long unbroken token overflows the paper and is silently clipped.
    const lines = wrapText(measure, "ماستموسیرزیتونخامهای", 30);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(30);
  });

  test("is one empty line for empty text, so a row still has height", () => {
    expect(wrapText(measure, "", 100)).toEqual([""]);
  });

  test("collapses runs of whitespace", () => {
    expect(wrapText(measure, "کره   گیاهی", 200)).toEqual(["کره گیاهی"]);
  });

  test("keeps every word", () => {
    const words = "الف ب پ ت ث ج چ ح خ".split(" ");
    const joined = wrapText(measure, words.join(" "), 40).join(" ").split(" ");
    expect(joined).toEqual(words);
  });
});

describe("truncateToWidth", () => {
  test("leaves text that fits", () => {
    expect(truncateToWidth(measure, "کوتاه", 200)).toBe("کوتاه");
  });

  test("adds an ellipsis when it does not", () => {
    const out = truncateToWidth(measure, "یک نام خیلی خیلی طولانی", 60);
    expect(out.endsWith("…")).toBe(true);
    expect(measure(out)).toBeLessThanOrEqual(60);
  });

  test("does not return an ellipsis alone", () => {
    expect(truncateToWidth(measure, "طولانی", 6)).not.toBe("…");
  });
});
