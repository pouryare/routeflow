import { describe, it, expect } from "vitest";
import { dayLoad } from "@/lib/capacityAhead";

const van = (id: number, driverId: number | null, maxStops: number | null = 6, maxWeightKg: number | null = null) => ({ id, driverId, maxStops, maxWeightKg, maxVolumeM3: null });
const d = (stops: number, weightKg = 0) => ({ stops, weightKg, volumeM3: 0 });

describe("day load", () => {
  it("is fine under the limit", () => expect(dayLoad("x", d(8), [van(1, 1), van(2, 2)], new Set()).status).toBe("ok"));
  it("is tight at 90 percent and over past it", () => {
    expect(dayLoad("x", d(11), [van(1, 1), van(2, 2)], new Set()).status).toBe("tight");
    expect(dayLoad("x", d(13), [van(1, 1), van(2, 2)], new Set()).status).toBe("over");
  });
  it("drops the van of an absent driver", () => {
    const l = dayLoad("x", d(8), [van(1, 1), van(2, 2)], new Set([2]));
    expect(l).toMatchObject({ status: "over", vans: 1, awayVans: 1 });
    expect(l.why).toMatch(/ایستگاه/);
  });
  it("says no van is free when every driver is away", () => {
    expect(dayLoad("x", d(2), [van(1, 1)], new Set([1]))).toMatchObject({ status: "over", why: "هیچ خودرویی آزاد نیست" });
  });
  it("cannot judge when no limit is set, and stays quiet on an empty day", () => {
    expect(dayLoad("x", d(5), [van(1, 1, null)], new Set()).status).toBe("nolimit");
    expect(dayLoad("x", d(0), [], new Set()).status).toBe("ok");
  });
  it("checks weight too", () => {
    expect(dayLoad("x", d(1, 900), [van(1, 1, 6, 800)], new Set()).status).toBe("over");
  });
});
