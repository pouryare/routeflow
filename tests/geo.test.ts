import { describe, it, expect } from "vitest";
import {
  distanceKm,
  corridorPolygon,
  distanceToSegmentKm,
  formatDistanceKm,
  nearestNeighborOrder,
  routeLengthKm,
  twoOptOrder,
} from "@/lib/geo";

describe("distanceKm", () => {
  it("is ~0 for the same point", () => {
    expect(distanceKm({ lat: 35.7, lng: 51.4 }, { lat: 35.7, lng: 51.4 })).toBeCloseTo(0, 5);
  });

  it("matches the known straight-line distance between Tehran and Damavand city", () => {
    const tehran = { lat: 35.6892, lng: 51.389 };
    const damavand = { lat: 35.7178, lng: 52.0658 };
    const km = distanceKm(tehran, damavand);
    expect(km).toBeGreaterThan(55);
    expect(km).toBeLessThan(70);
  });

  it("is symmetric", () => {
    const a = { lat: 35.7, lng: 51.4 };
    const b = { lat: 35.75, lng: 51.5 };
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 10);
  });
});

describe("nearestNeighborOrder", () => {
  it("visits the closest unvisited stop next, starting from the given point", () => {
    const stops = [
      { id: "far", lat: 10, lng: 10 },
      { id: "near", lat: 0.01, lng: 0.01 },
      { id: "mid", lat: 1, lng: 1 },
    ];
    const ordered = nearestNeighborOrder(stops, { lat: 0, lng: 0 });
    expect(ordered.map((s) => s.id)).toEqual(["near", "mid", "far"]);
  });

  it("starts from the first stop when no starting point is given", () => {
    const stops = [
      { id: "a", lat: 0, lng: 0 },
      { id: "b", lat: 5, lng: 5 },
      { id: "c", lat: 0.1, lng: 0.1 },
    ];
    const ordered = nearestNeighborOrder(stops, null);
    expect(ordered).toHaveLength(3);
    expect(ordered[0].id).toBe("a");
    // after "a", "c" (close to a) should come before the distant "b"
    expect(ordered[1].id).toBe("c");
  });

  it("preserves every stop exactly once", () => {
    const stops = Array.from({ length: 8 }, (_, i) => ({ id: i, lat: Math.random() * 10, lng: Math.random() * 10 }));
    const ordered = nearestNeighborOrder(stops, { lat: 5, lng: 5 });
    expect(new Set(ordered.map((s) => s.id))).toEqual(new Set(stops.map((s) => s.id)));
  });

  it("handles an empty stop list", () => {
    expect(nearestNeighborOrder([], { lat: 0, lng: 0 })).toEqual([]);
  });
});

describe("formatDistanceKm", () => {
  it("switches to metres below one kilometre, where a decimal km reads as false precision", () => {
    expect(formatDistanceKm(0.42)).toBe("420 متر");
    expect(formatDistanceKm(0.999)).toBe("999 متر");
  });

  it("uses one decimal kilometre above that", () => {
    expect(formatDistanceKm(1)).toBe("1.0 کیلومتر");
    expect(formatDistanceKm(28.14)).toBe("28.1 کیلومتر");
  });
})

describe("routeLengthKm", () => {
  const origin = { lat: 35.75, lng: 51.8 };
  const a = { lat: 35.70, lng: 51.7 };
  const c = { lat: 35.60, lng: 51.6 };

  it("is 0 with no stops, whether or not it returns", () => {
    expect(routeLengthKm(origin, [], false)).toBe(0);
    expect(routeLengthKm(origin, [], true)).toBe(0);
  });

  it("measures origin -> stop for a single stop", () => {
    expect(routeLengthKm(origin, [a], false)).toBeCloseTo(distanceKm(origin, a), 6);
  });

  it("sums every leg in order", () => {
    const expected = distanceKm(origin, a) + distanceKm(a, c);
    expect(routeLengthKm(origin, [a, c], false)).toBeCloseTo(expected, 6);
  });

  it("adds the leg home when the day returns to its origin", () => {
    const oneWay = routeLengthKm(origin, [a, c], false);
    expect(routeLengthKm(origin, [a, c], true)).toBeCloseTo(oneWay + distanceKm(c, origin), 6);
  });
})

describe("twoOptOrder", () => {
  const origin = { lat: 35.0, lng: 51.0 };
  // Four points on a line. Visiting them out of order forces a crossing that a greedy
  // pass can leave behind and 2-opt must remove.
  const pts = [
    { lat: 35.0, lng: 51.1, id: 1 },
    { lat: 35.0, lng: 51.2, id: 2 },
    { lat: 35.0, lng: 51.3, id: 3 },
    { lat: 35.0, lng: 51.4, id: 4 },
  ];

  it("straightens a deliberately crossed route", () => {
    const crossed = [pts[2], pts[0], pts[3], pts[1]];
    const fixed = twoOptOrder(crossed, origin, false);
    expect(fixed.map((p) => p.id)).toEqual([1, 2, 3, 4]);
  });

  // The whole point is that it can only help. If it ever returned a longer route the
  // planner would be actively making days worse.
  it("never returns a route longer than the one it was given", () => {
    for (let trial = 0; trial < 200; trial++) {
      const stops = Array.from({ length: 7 }, () => ({
        lat: 35 + Math.random(),
        lng: 51 + Math.random(),
      }));
      const before = routeLengthKm(origin, stops, false);
      const after = routeLengthKm(origin, twoOptOrder(stops, origin, false), false);
      expect(after).toBeLessThanOrEqual(before + 1e-9);
    }
  });

  it("keeps every stop exactly once", () => {
    const stops = pts.slice().reverse();
    const out = twoOptOrder(stops, origin, false);
    expect(out).toHaveLength(stops.length);
    expect(new Set(out.map((p) => p.id)).size).toBe(stops.length);
  });

  it("optimises for the return leg when the day ends at its origin", () => {
    const stops = [pts[0], pts[3], pts[1], pts[2]];
    const out = twoOptOrder(stops, origin, true);
    expect(routeLengthKm(origin, out, true)).toBeLessThanOrEqual(routeLengthKm(origin, stops, true) + 1e-9);
  });

  it("passes through fewer than two stops untouched", () => {
    expect(twoOptOrder([], origin, false)).toEqual([]);
    expect(twoOptOrder([pts[0]], origin, false)).toEqual([pts[0]]);
  });
})

describe("distanceToSegmentKm", () => {
  const a = { lat: 35.0, lng: 51.0 };
  const b = { lat: 35.0, lng: 52.0 };

  it("is 0 for a point on the segment", () => {
    expect(distanceToSegmentKm({ lat: 35.0, lng: 51.5 }, a, b)).toBeCloseTo(0, 3);
  });

  it("measures the perpendicular drop for a point beside the segment", () => {
    const p = { lat: 35.05, lng: 51.5 };
    expect(distanceToSegmentKm(p, a, b)).toBeCloseTo(distanceKm(p, { lat: 35.0, lng: 51.5 }), 1);
  });

  // The two cases a naive perpendicular-distance formula gets wrong: a point past
  // either end must measure to that endpoint, not to the infinite line through it.
  it("clamps to the near endpoint when the projection falls beyond the segment", () => {
    const before = { lat: 35.0, lng: 50.0 };
    expect(distanceToSegmentKm(before, a, b)).toBeCloseTo(distanceKm(before, a), 1);

    const after = { lat: 35.0, lng: 53.0 };
    expect(distanceToSegmentKm(after, a, b)).toBeCloseTo(distanceKm(after, b), 1);
  });

  it("handles a zero-length segment as distance to that single point", () => {
    const p = { lat: 35.2, lng: 51.2 };
    expect(distanceToSegmentKm(p, a, a)).toBeCloseTo(distanceKm(p, a), 3);
  });

  it("is symmetric in the segment's endpoints", () => {
    const p = { lat: 35.3, lng: 51.4 };
    expect(distanceToSegmentKm(p, a, b)).toBeCloseTo(distanceToSegmentKm(p, b, a), 6);
  });
})

describe("corridorPolygon", () => {
  const a = { lat: 35.75, lng: 51.80 };
  const b = { lat: 35.50, lng: 51.75 };

  it("returns a four-cornered band", () => {
    expect(corridorPolygon(a, b, 5)).toHaveLength(4);
  });

  // The band's whole purpose is "everything within N km of the drive", so its corners
  // have to actually sit N km from the line.
  it("puts every corner the requested half-width from the segment", () => {
    for (const [lat, lng] of corridorPolygon(a, b, 5)) {
      expect(distanceToSegmentKm({ lat, lng }, a, b)).toBeCloseTo(5, 1);
    }
  });

  it("scales with the requested width", () => {
    const narrow = corridorPolygon(a, b, 2);
    const wide = corridorPolygon(a, b, 10);
    expect(distanceToSegmentKm({ lat: narrow[0][0], lng: narrow[0][1] }, a, b)).toBeCloseTo(2, 1);
    expect(distanceToSegmentKm({ lat: wide[0][0], lng: wide[0][1] }, a, b)).toBeCloseTo(10, 1);
  });

  it("returns nothing for a zero-length segment, which has no direction to widen", () => {
    expect(corridorPolygon(a, a, 5)).toEqual([]);
  });
})
