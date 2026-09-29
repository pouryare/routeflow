import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/* Spec §4.10 + Phase A §5.0: the banner must name BOTH facts — who you are acting as, AND
 * in which world.
 *
 * "You are seeing the app as Ali" stops being true the moment a person can hold two roles:
 * as a driver Ali sees three tabs, as a field rep nineteen. An owner reading over a driver's
 * shoulder must never be confused about whose permissions are being exercised. */
describe("ImpersonationBanner", () => {
  const src = readFileSync("components/meridian/ImpersonationBanner.tsx", "utf8");
  /* The no-dismiss rule is checked against CODE ONLY. The component's comment explains WHY
     it cannot be dismissed and necessarily contains the word — a source-wide regex asserts
     on prose, and the first version of this test failed on its own comment. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("names the role as well as the person", () => {
    expect(src).toContain("asRole");
    expect(src).toContain("{asRole}");
  });

  it("keeps the way back, and cannot be dismissed", () => {
    expect(src).toContain("بازگشت به حساب خودم");
    // Deliberately no dismiss/close: forgetting you are signed in as someone else, and then
    // acting on their behalf, is the exact mistake this component exists to prevent.
    expect(code).not.toMatch(/dismiss|onClose/);
  });

  it("still says the work is recorded in their name", () => {
    expect(src).toMatch(/به نام او ثبت می‌شود/);
  });

  it("AppHeader passes the role, so the prop is never silently undefined", () => {
    const header = readFileSync("components/meridian/AppHeader.tsx", "utf8");
    expect(header).toMatch(/ImpersonationBanner[\s\S]{0,120}asRole=/);
  });
});
