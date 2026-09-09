import { describe, it, expect } from "vitest";
import { resolveTheme } from "@/lib/theme";

describe("resolveTheme", () => {
  it("auto follows the OS preference", () => {
    expect(resolveTheme("auto", true, false)).toBe("light");
    expect(resolveTheme("auto", false, false)).toBe("dark");
  });

  it("an explicit choice overrides the OS preference", () => {
    expect(resolveTheme("light", false, false)).toBe("light");
    expect(resolveTheme("dark", true, false)).toBe("dark");
  });

  it("no stored value defaults to auto behaviour", () => {
    expect(resolveTheme(null, true, false)).toBe("light");
    expect(resolveTheme(null, false, false)).toBe("dark");
  });

  it("driver routes ignore auto and pin to the explicit choice, defaulting dark", () => {
    expect(resolveTheme("auto", true, true)).toBe("dark");
    expect(resolveTheme(null, true, true)).toBe("dark");
    expect(resolveTheme("light", true, true)).toBe("light");
  });
});
