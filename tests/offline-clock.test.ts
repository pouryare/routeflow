import { describe, it, expect } from "vitest";
import { measureSkew, toServerTime, skewIsSuspect } from "@/lib/offline/clock";

describe("clock skew", () => {
  it("is positive when the device is slow", () => {
    const serverIso = "2026-01-01T12:00:05.000Z";
    const clientMs = Date.parse("2026-01-01T12:00:00.000Z");
    expect(measureSkew(serverIso, clientMs)).toBe(5000);
  });

  it("toServerTime applies the skew", () => {
    expect(toServerTime("2026-01-01T10:15:00.000Z", 5000)).toBe("2026-01-01T10:15:05.000Z");
  });

  it("zero skew is identity", () => {
    expect(toServerTime("2026-01-01T10:15:00.000Z", 0)).toBe("2026-01-01T10:15:00.000Z");
  });

  it("flags a clock off by more than a minute", () => {
    expect(skewIsSuspect(30_000)).toBe(false);
    expect(skewIsSuspect(-90_000)).toBe(true);
  });
});
