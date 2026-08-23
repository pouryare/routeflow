import { describe, expect, it } from "vitest";
import { matchesQuery, normalisePersian } from "@/lib/persian";

describe("normalisePersian", () => {
  it("folds the Arabic yeh and kaf onto their Persian forms", () => {
    // The single most common cause of a customer appearing not to exist: the spreadsheet
    // holds the Arabic codepoints, the phone keyboard emits the Persian ones.
    expect(normalisePersian("كترينگ")).toBe(normalisePersian("کترینگ"));
  });

  it("ignores the zero-width non-joiner inside compounds", () => {
    expect(normalisePersian("کسب‌وکار")).toBe(normalisePersian("کسبوکار"));
  });

  it("folds the three written alefs together", () => {
    expect(normalisePersian("آذربایجان")).toBe(normalisePersian("اذربایجان"));
    expect(normalisePersian("أحمد")).toBe(normalisePersian("احمد"));
  });

  it("folds teh marbuta onto heh", () => {
    expect(normalisePersian("مرحلة")).toBe(normalisePersian("مرحله"));
  });

  it("converts Persian and Arabic-Indic digits to ASCII", () => {
    // A code displayed as ۱۳۰۰۰۲ has to be findable by typing it on a Latin keypad.
    expect(normalisePersian("۱۳۰۰۰۲")).toBe("130002");
    expect(normalisePersian("١٢٣")).toBe("123");
  });

  it("strips Arabic diacritics", () => {
    expect(normalisePersian("مُحَمَّد")).toBe(normalisePersian("محمد"));
  });

  it("collapses whitespace and lowercases Latin text", () => {
    expect(normalisePersian("  Coffee   Shop ")).toBe("coffee shop");
  });
});

describe("matchesQuery", () => {
  it("matches across the two spellings in either direction", () => {
    expect(matchesQuery("كترينگ آرين", "کترینگ")).toBe(true);
    expect(matchesQuery("کترینگ آرین", "كترينگ")).toBe(true);
  });

  it("matches a Persian-digit code typed in Latin digits", () => {
    expect(matchesQuery("کد ۱۳۰۰۰۲", "130002")).toBe(true);
  });

  it("treats an empty query as no filter", () => {
    expect(matchesQuery("anything", "")).toBe(true);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });

  it("still says no when it is genuinely absent", () => {
    expect(matchesQuery("کترینگ آرین", "پیتزا")).toBe(false);
  });
});
