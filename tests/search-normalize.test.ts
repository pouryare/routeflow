import { describe, it, expect } from "vitest";
import { normalizeSearch } from "@/lib/search/normalize";

describe("normalizeSearch", () => {
  it("maps Persian and Arabic digits to ASCII", () => {
    expect(normalizeSearch("۱۲۳٤٥")).toBe("12345");
  });
  it("unifies Arabic yeh/kaf with the Persian letters", () => {
    expect(normalizeSearch("بقالي كوچك")).toBe(normalizeSearch("بقالی کوچک"));
  });
  it("ignores half-spaces and case, and trims", () => {
    expect(normalizeSearch("  می‌خواهم ABC ")).toBe("میخواهم abc");
  });
});
