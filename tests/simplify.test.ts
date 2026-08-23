import { describe, it, expect } from "vitest";
import { decimateGeometry, polygonCentroid, roundPosition, simplifyRing, type Ring } from "@/lib/simplify";

/** A closed square ring padded with points that sit exactly on its edges. Every padding
 *  point is redundant, so any working simplifier drops all of them and keeps the corners. */
function paddedSquare(): Ring {
  return [
    [0, 0],
    [0.25, 0],
    [0.5, 0],
    [0.75, 0],
    [1, 0],
    [1, 0.5],
    [1, 1],
    [0.5, 1],
    [0, 1],
    [0, 0.5],
    [0, 0],
  ];
}

describe("simplifyRing", () => {
  it("drops collinear padding but keeps the corners", () => {
    const out = simplifyRing(paddedSquare(), 0.01);
    expect(out).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
  });

  it("keeps a vertex that deviates by more than the tolerance", () => {
    const ring: Ring = [
      [0, 0],
      [0.5, 0.2],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(simplifyRing(ring, 0.05)).toHaveLength(5);
    expect(simplifyRing(ring, 0.5)).toHaveLength(4);
  });

  it("leaves the ring alone at zero tolerance", () => {
    const ring = paddedSquare();
    expect(simplifyRing(ring, 0)).toEqual(ring);
  });

  it("never emits fewer than the 4 positions a linear ring requires", () => {
    // A degenerate ring: every point is collinear, so an unguarded simplifier would
    // reduce it to 2 positions and produce geometry Leaflet silently refuses to draw.
    const ring: Ring = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [0, 0],
    ];
    expect(simplifyRing(ring, 1).length).toBeGreaterThanOrEqual(4);
  });

  it("stays closed", () => {
    const out = simplifyRing(paddedSquare(), 0.01);
    expect(out[0]).toEqual(out[out.length - 1]);
  });

  it("handles a long, near-collinear ring without overflowing the stack", () => {
    // The pathological input for a recursive Douglas-Peucker: 50k points along an
    // almost-straight line, which recurses once per point and blows the call stack.
    // The wiggle amplitude is well above the tolerance so real vertices survive and
    // the result isn't just the degenerate-ring guard returning the input.
    const ring: Ring = [];
    for (let i = 0; i < 50_000; i++) ring.push([i / 50_000, Math.sin(i / 100) * 0.01]);
    ring.push(ring[0]);

    let out: Ring = [];
    expect(() => {
      out = simplifyRing(ring, 0.0001);
    }).not.toThrow();
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThan(ring.length / 2);
  });
});

describe("roundPosition", () => {
  it("rounds both components to the requested decimals", () => {
    expect(roundPosition([51.3836931234567, 35.8111421234567], 4)).toEqual([51.3837, 35.8111]);
    expect(roundPosition([51.3836931234567, 35.8111421234567], 6)).toEqual([51.383693, 35.811142]);
  });
});

describe("decimateGeometry", () => {
  it("simplifies and rounds every ring of a Polygon", () => {
    const out = decimateGeometry(
      { type: "Polygon", coordinates: [paddedSquare().map(([x, y]) => [x + 0.000049, y] as [number, number])] },
      0.01,
      4
    );
    expect(out.type).toBe("Polygon");
    expect(out.coordinates[0]).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]);
  });

  it("descends one level deeper for a MultiPolygon", () => {
    const out = decimateGeometry(
      { type: "MultiPolygon", coordinates: [[paddedSquare()], [paddedSquare()]] },
      0.01,
      4
    );
    expect(out.type).toBe("MultiPolygon");
    expect(out.coordinates).toHaveLength(2);
    expect((out.coordinates as number[][][][])[0][0]).toHaveLength(5);
    expect((out.coordinates as number[][][][])[1][0]).toHaveLength(5);
  });
});

describe("polygonCentroid", () => {
  const square = (x: number, y: number, size: number): Ring => [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];

  it("puts a square's centroid at its middle", () => {
    const c = polygonCentroid({ type: "Polygon", coordinates: [square(0, 0, 10)] });
    expect(c!.lng).toBeCloseTo(5, 6);
    expect(c!.lat).toBeCloseTo(5, 6);
  });

  it("is unaffected by ring winding direction", () => {
    const cw = polygonCentroid({ type: "Polygon", coordinates: [square(0, 0, 10)] });
    const ccw = polygonCentroid({ type: "Polygon", coordinates: [square(0, 0, 10).slice().reverse()] });
    expect(ccw!.lat).toBeCloseTo(cw!.lat, 6);
    expect(ccw!.lng).toBeCloseTo(cw!.lng, 6);
  });

  // A district is one shape even when the data models it as several rings; weighting by
  // area stops a tiny outlying island from dragging the centre off the main body.
  it("weights a multipolygon by area, not by ring count", () => {
    const c = polygonCentroid({
      type: "MultiPolygon",
      coordinates: [[square(0, 0, 10)], [square(100, 0, 1)]],
    });
    expect(c!.lng).toBeGreaterThan(4);
    expect(c!.lng).toBeLessThan(6);
  });

  it("ignores holes in the outer ring's own position", () => {
    const c = polygonCentroid({ type: "Polygon", coordinates: [square(0, 0, 10), square(4, 4, 2)] });
    expect(c!.lng).toBeCloseTo(5, 1);
    expect(c!.lat).toBeCloseTo(5, 1);
  });

  // A zero-area ring makes the shoelace formula divide by zero; the bounding-box centre
  // is a defensible answer and a NaN pin on the map is not.
  it("falls back to the bounding-box centre for a degenerate ring", () => {
    const line: Ring = [[0, 0], [10, 0], [0, 0]];
    const c = polygonCentroid({ type: "Polygon", coordinates: [line] });
    expect(Number.isFinite(c!.lat)).toBe(true);
    expect(Number.isFinite(c!.lng)).toBe(true);
    expect(c!.lng).toBeCloseTo(5, 6);
  });

  it("returns null for geometry with no usable coordinates", () => {
    expect(polygonCentroid({ type: "Polygon", coordinates: [] })).toBeNull();
  });
})
