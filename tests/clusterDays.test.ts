import { describe, expect, it } from "vitest";
import { clusterIntoDays, daysNeeded } from "@/lib/clusterDays";

/** Three well-separated towns around Tehran, five stops each. Any honest clustering has
 *  to recover these groups; the old chunk-a-greedy-chain approach did not. */
const PARDIS = { lat: 35.74, lng: 51.82 };
const KARAJ = { lat: 35.84, lng: 50.94 };
const VARAMIN = { lat: 35.32, lng: 51.65 };

function around(centre: { lat: number; lng: number }, n: number, tag: string) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${tag}${i}`,
    lat: centre.lat + (i - n / 2) * 0.004,
    lng: centre.lng + (i % 3) * 0.004,
  }));
}

const HOME = { lat: 35.7, lng: 51.4 };

describe("clusterIntoDays", () => {
  it("recovers genuinely separate areas as separate days", () => {
    const stops = [...around(PARDIS, 5, "p"), ...around(KARAJ, 5, "k"), ...around(VARAMIN, 5, "v")];
    const days = clusterIntoDays(stops, 3, HOME);

    expect(days).toHaveLength(3);
    for (const day of days) {
      const tags = new Set(day.stops.map((s) => s.id[0]));
      // Every day is one town, not a mix -- the property the old chunking broke.
      expect(tags.size).toBe(1);
    }
  });

  it("keeps the days about the same size rather than one huge and one tiny", () => {
    // Plain k-means would happily return 11 and 4 here; a working day cannot.
    const stops = [...around(PARDIS, 11, "p"), ...around(KARAJ, 4, "k")];
    const days = clusterIntoDays(stops, 2, HOME);
    const sizes = days.map((d) => d.stops.length).sort((a, b) => a - b);
    expect(sizes[1] - sizes[0]).toBeLessThanOrEqual(1);
  });

  it("gives the same answer every time it is asked", () => {
    // The whole reason seeding is farthest-point rather than random: a split that
    // changes between two looks at the same list is a split nobody can trust.
    const stops = [...around(PARDIS, 6, "p"), ...around(KARAJ, 6, "k")];
    const a = clusterIntoDays(stops, 2, HOME).map((d) => d.stops.map((s) => s.id));
    const b = clusterIntoDays(stops, 2, HOME).map((d) => d.stops.map((s) => s.id));
    expect(a).toEqual(b);
  });

  it("puts the nearest day first", () => {
    const stops = [...around(PARDIS, 4, "p"), ...around(KARAJ, 4, "k")];
    const days = clusterIntoDays(stops, 2, HOME);
    const first = days[0].stops[0].id[0];
    // Pardis is ~38km from HOME, Karaj ~42km -- close, so assert via the centres rather
    // than by eye.
    const d0 = Math.hypot(days[0].centre.lat - HOME.lat, days[0].centre.lng - HOME.lng);
    const d1 = Math.hypot(days[1].centre.lat - HOME.lat, days[1].centre.lng - HOME.lng);
    expect(d0).toBeLessThanOrEqual(d1);
    expect(["p", "k"]).toContain(first);
  });

  it("never loses or duplicates a stop", () => {
    const stops = [...around(PARDIS, 7, "p"), ...around(KARAJ, 5, "k"), ...around(VARAMIN, 3, "v")];
    const days = clusterIntoDays(stops, 4, HOME);
    const out = days.flatMap((d) => d.stops.map((s) => s.id)).sort();
    expect(out).toEqual(stops.map((s) => s.id).sort());
  });

  it("returns fewer days than asked rather than empty ones", () => {
    // Four days out of three stops is three days, not three plus a gap.
    const stops = around(PARDIS, 3, "p");
    const days = clusterIntoDays(stops, 4, HOME);
    expect(days).toHaveLength(3);
    for (const d of days) expect(d.stops.length).toBeGreaterThan(0);
  });

  it("handles the trivial cases", () => {
    expect(clusterIntoDays([], 3, HOME)).toEqual([]);
    const one = clusterIntoDays(around(PARDIS, 4, "p"), 1, HOME);
    expect(one).toHaveLength(1);
    expect(one[0].stops).toHaveLength(4);
  });

  it("works with no origin, still without losing anything", () => {
    const stops = [...around(PARDIS, 4, "p"), ...around(KARAJ, 4, "k")];
    const days = clusterIntoDays(stops, 2, null);
    expect(days.flatMap((d) => d.stops)).toHaveLength(8);
  });

  it("orders each day from the origin rather than leaving it arbitrary", () => {
    // A day of stops laid out along a line should not start at the far end.
    const line = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, lat: 35.7 + i * 0.01, lng: 51.4 }));
    const [day] = clusterIntoDays(line, 1, HOME);
    expect(day.stops[0].id).toBe("s0");
    expect(day.stops[4].id).toBe("s4");
  });
});

describe("daysNeeded", () => {
  it("rounds up", () => {
    expect(daysNeeded(17, 8)).toBe(3);
    expect(daysNeeded(16, 8)).toBe(2);
  });

  it("is zero for nothing to do", () => {
    expect(daysNeeded(0, 8)).toBe(0);
  });
});
