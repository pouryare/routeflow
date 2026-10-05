import { describe, it, expect } from "vitest";
import { splitIntoDays } from "@/lib/routing/splitIntoDays";
import { straightLine } from "@/lib/routing/distance";
import type { LatLng } from "@/lib/geo";

const DEPOT: LatLng = { lat: 35.7, lng: 51.4 };

function line(count: number, step = 0.02) {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    lat: 35.6 + i * step,
    lng: 51.3 + i * step,
  }));
}

describe("splitIntoDays", () => {
  it("reports which measure produced the plan", () => {
    const plan = splitIntoDays(line(2, 0.004), {
      stopsPerDay: 5,
      origin: DEPOT,
      distanceFn: straightLine,
    });
    // Carried, not assumed. A plan laid out on straight lines in a city with a mountain pass
    // through it is a different plan, and the caller is the only one who can say so.
    expect(plan.quality).toBe("straight-line");
    expect(plan.days).toHaveLength(1);
  });

  it("reports roads when given a road matrix", () => {
    const plan = splitIntoDays(line(2, 0.004), {
      stopsPerDay: 5,
      origin: DEPOT,
      distanceFn: (a, b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) * 3,
    });
    expect(plan.quality).toBe("roads");
  });

  it("splits once the set is larger than one day's worth", () => {
    const plan = splitIntoDays(line(10), {
      stopsPerDay: 3,
      origin: DEPOT,
      distanceFn: straightLine,
    });
    expect(plan.days.length).toBe(4); // 10 stops at 3 a day: 3,3,3,1
  });

  it("puts no more than stopsPerDay in any day", () => {
    // The cap is the cap. 10 stops at 3 a day is 3+3+3+1, not an even 4+3+3 -- a day split
    // is a promise about how much driving a day holds, and an even split would break it in
    // the direction of overloading one van.
    const plan = splitIntoDays(line(10), {
      stopsPerDay: 3,
      origin: DEPOT,
      distanceFn: straightLine,
    });
    for (const d of plan.days) expect(d.stops.length).toBeLessThanOrEqual(3);
    expect(plan.days.flatMap((d) => d.stops)).toHaveLength(10);
  });

  it("returns nothing for an empty list", () => {
    const plan = splitIntoDays([], { stopsPerDay: 5, origin: DEPOT });
    expect(plan.days).toEqual([]);
  });
});