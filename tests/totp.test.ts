import { describe, it, expect } from "vitest";
import { base32Decode, base32Encode, otpauthUri, totpAt, verifyTotp } from "@/lib/totp";

// RFC 6238 appendix B, SHA-1, secret "12345678901234567890", 8 digits there; we use the last 6.
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the RFC 6238 test vectors", () => {
    expect(totpAt(SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(SECRET, Math.floor(1234567890 / 30))).toBe("005924");
  });
  it("round-trips base32", () => {
    expect(base32Decode(SECRET).toString()).toBe("12345678901234567890");
  });
  it("accepts the neighbouring step for clock drift, not further", () => {
    const t = 1234567890 * 1000;
    const step = Math.floor(1234567890 / 30);
    expect(verifyTotp(SECRET, totpAt(SECRET, step), null, t)).toBe(step);
    expect(verifyTotp(SECRET, totpAt(SECRET, step - 1), null, t)).toBe(step - 1);
    expect(verifyTotp(SECRET, totpAt(SECRET, step + 2), null, t)).toBeNull();
  });
  it("refuses a step that was already used", () => {
    const t = 1234567890 * 1000;
    const step = Math.floor(1234567890 / 30);
    expect(verifyTotp(SECRET, totpAt(SECRET, step), step, t)).toBeNull();
  });
  it("refuses malformed codes", () => {
    expect(verifyTotp(SECRET, "12345", null)).toBeNull();
    expect(verifyTotp(SECRET, "abcdef", null)).toBeNull();
  });
  it("builds an otpauth uri", () => {
    expect(otpauthUri("ABC", "founder")).toContain("secret=ABC");
  });
});
