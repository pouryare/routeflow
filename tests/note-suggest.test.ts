import { describe, expect, it } from "vitest";
import { noteSuggestions } from "@/lib/noteSuggest";

const past = ["تماس با مشتری", "تماس بگیرم", "تماس با مشتری", "ارسال قیمت‌ها", "تماس با مشتری جدید"];

describe("noteSuggestions", () => {
  it("offers nothing for an empty box", () => expect(noteSuggestions("  ", past)).toEqual([]));
  it("matches the start, most used first", () => {
    expect(noteSuggestions("تماس", past)).toEqual(["تماس با مشتری", "تماس بگیرم", "تماس با مشتری جدید"]);
  });
  it("does not offer what is already typed, and honours the limit", () => {
    expect(noteSuggestions("تماس با مشتری", past)).toEqual(["تماس با مشتری جدید"]);
    expect(noteSuggestions("تماس", past, 1)).toEqual(["تماس با مشتری"]);
  });
});
