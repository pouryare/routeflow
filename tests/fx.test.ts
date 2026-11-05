import { describe, it, expect } from "vitest";
import { fxOn, isWeakPhone, isCompanyFx } from "@/lib/fx";

const base = { company: "auto" as const, person: null, reducedMotion: false, weak: false };

describe("decorative effects switch", () => {
  it("are on by default and off on a weak phone", () => {
    expect(fxOn(base)).toBe(true);
    expect(fxOn({ ...base, weak: true })).toBe(false);
  });
  it("the owner's off beats everything, including a person's own on", () => {
    expect(fxOn({ ...base, company: "off", person: "on" })).toBe(false);
  });
  it("a person can turn them off, or on even on a weak phone, but never past reduced motion", () => {
    expect(fxOn({ ...base, person: "off" })).toBe(false);
    expect(fxOn({ ...base, person: "on", weak: true })).toBe(true);
    expect(fxOn({ ...base, person: "on", reducedMotion: true })).toBe(false);
  });
  it("weak means little memory or few cores; unknown is not weak", () => {
    expect(isWeakPhone(2, 8)).toBe(true);
    expect(isWeakPhone(8, 4)).toBe(true);
    expect(isWeakPhone(8, 8)).toBe(false);
    expect(isWeakPhone(undefined, undefined)).toBe(false);
  });
  it("only auto and off are company values", () => {
    expect(isCompanyFx("auto") && isCompanyFx("off")).toBe(true);
    expect(isCompanyFx("on")).toBe(false);
  });
});
