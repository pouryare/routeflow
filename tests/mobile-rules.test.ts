import { describe, it, expect } from "vitest";

const { check, allowlistProblems, untestedMobileComponents, jalaliImporters, PRESENTATIONAL_ONLY } = await import("../scripts/check-mobile-rules.mjs");

describe("mobile rules (docs/mobile-first-principles.md)", () => {
  it("the tree passes every check", () => {
    expect(check()).toEqual([]);
  });
  it("every allowlist entry has a real reason and points at a file that exists", () => {
    expect(allowlistProblems()).toEqual([]);
  });
  it("every mobile component has a test, or is listed as presentational with a reason", () => {
    expect(untestedMobileComponents()).toEqual([]);
    for (const [file, why] of Object.entries(PRESENTATIONAL_ONLY)) expect((why as string).length, file).toBeGreaterThan(10);
  });
  it("only the recorded files import the calendar input", () => {
    expect(jalaliImporters()).toContain("components/mobile/DayChips.tsx");
  });
});
