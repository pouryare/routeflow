import { describe, expect, it } from "vitest";
import { passwordRules } from "@/lib/passwordStrength";

describe("passwordRules", () => {
  it("meets nothing for a short plain word", () => {
    expect(passwordRules("abc").score).toBe(0);
  });
  it("counts length, digit and mix", () => {
    expect(passwordRules("Abcdefg1").score).toBe(3);
  });
  it("meets all four", () => {
    expect(passwordRules("Abcdefghijk1!").score).toBe(4);
  });
  it("takes a Persian digit as a digit", () => {
    expect(passwordRules("رمز۱").rules.find((r) => r.id === "digit")?.met).toBe(true);
  });
});
