import { describe, it, expect } from "vitest";
import { hourBuckets, busiestHour } from "@/lib/hourBuckets";

describe("hour buckets", () => {
  it("counts by Tehran hour, not UTC", () => {
    // 06:30 UTC is 10:00 in Tehran (UTC+3:30); 20:45 UTC is 00:15 the next day.
    const c = hourBuckets(["2026-11-04T06:30:00Z", "2026-11-04T06:45:00Z", "2026-11-04T20:45:00Z"]);
    expect(c[10]).toBe(2);
    expect(c[0]).toBe(1);
    expect(c.reduce((a, b) => a + b, 0)).toBe(3);
  });
  it("skips timestamps that do not parse", () => {
    expect(hourBuckets(["", "not a date"]).every((n) => n === 0)).toBe(true);
  });
  it("finds the busiest hour, the first when tied, and none when empty", () => {
    expect(busiestHour([0, 3, 5, 5])).toBe(2);
    expect(busiestHour(Array(24).fill(0))).toBeNull();
  });
});
