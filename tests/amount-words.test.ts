import { describe, it, expect } from "vitest";
import { numberToWords, tomanInWords } from "@/lib/amountWords";

describe("amount in words (F116)", () => {
  it.each([
    [0, "صفر"],
    [1, "یک"],
    [10, "ده"],
    [11, "یازده"],
    [19, "نوزده"],
    [20, "بیست"],
    [21, "بیست و یک"],
    [100, "صد"],
    [105, "صد و پنج"],
    [110, "صد و ده"],
    [999, "نهصد و نود و نه"],
    [1000, "یک هزار"],
    [1001, "یک هزار و یک"],
    [12_500, "دوازده هزار و پانصد"],
    [250_000, "دویست و پنجاه هزار"],
    [1_000_000, "یک میلیون"],
    [2_500_000, "دو میلیون و پانصد هزار"],
    [1_000_050, "یک میلیون و پنجاه"],
    [38_740_000, "سی و هشت میلیون و هفتصد و چهل هزار"],
    [3_000_000_000, "سه میلیارد"],
    [1_200_000_300, "یک میلیارد و دویست میلیون و سیصد"],
  ])("%d", (n, words) => {
    expect(numberToWords(n)).toBe(words);
  });

  it("rounds a fraction and writes a negative", () => {
    expect(numberToWords(99.6)).toBe("صد");
    expect(numberToWords(-1500)).toBe("منفی یک هزار و پانصد");
  });

  it("adds the currency", () => {
    expect(tomanInWords(2_500_000)).toBe("دو میلیون و پانصد هزار تومان");
  });

  it("refuses what it cannot write", () => {
    expect(() => numberToWords(Number.NaN)).toThrow();
    expect(() => numberToWords(1e15)).toThrow();
  });
});
