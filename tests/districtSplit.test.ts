import { describe, it, expect } from "vitest";
import { planSplit, directionWord, spanKm, type LngLat, type PolyGeometry } from "@/lib/districtSplit";

/** A small square of `size` degrees centred on (lng, lat). */
function square(lng: number, lat: number, size = 0.01): LngLat[] {
  const h = size / 2;
  return [
    [lng - h, lat - h],
    [lng + h, lat - h],
    [lng + h, lat + h],
    [lng - h, lat + h],
    [lng - h, lat - h],
  ];
}
const multi = (...rings: LngLat[][]): PolyGeometry => ({
  type: "MultiPolygon",
  coordinates: rings.map((r) => [r]),
});

describe("planSplit", () => {
  it("leaves a single-part district alone", () => {
    expect(planSplit("ونک", { type: "Polygon", coordinates: [square(51.4, 35.75)] })).toBeNull();
  });

  it("leaves two lobes of one neighbourhood merged", () => {
    // Adjacent placemarks of the same area -- the case the seeder's merge exists for.
    expect(planSplit("پونک", multi(square(51.33, 35.76, 0.02), square(51.35, 35.76, 0.02)))).toBeNull();
  });

  it("splits two places 20km apart that merely share a name", () => {
    // کوهسار as the real data has it: one in the west, one out by Tehranpars.
    const pieces = planSplit("کوهسار", multi(square(51.55, 35.75, 0.03), square(51.38, 35.80, 0.02)));
    expect(pieces).toHaveLength(2);
    expect(pieces!.filter((p) => p.keepsOriginal)).toHaveLength(1);
  });

  it("keeps the original name on the largest piece", () => {
    const pieces = planSplit("کوهسار", multi(square(51.55, 35.75, 0.03), square(51.38, 35.80, 0.01)))!;
    const main = pieces.find((p) => p.keepsOriginal)!;
    expect(main.name).toBe("کوهسار");
    // Whatever history and shared links already point here belong to the main body.
    expect(spanKm(main.geometry.coordinates[0])).toBeGreaterThan(
      spanKm(pieces.find((p) => !p.keepsOriginal)!.geometry.coordinates[0])
    );
  });

  it("names the other piece by the direction that actually separates them", () => {
    const pieces = planSplit("کوهسار", multi(square(51.55, 35.75, 0.03), square(51.38, 35.75, 0.01)))!;
    expect(pieces.find((p) => !p.keepsOriginal)!.name).toBe("کوهسار (غرب)");
  });

  it("does not split a large rural district whose parts are far apart because it is huge", () => {
    // بخش شریف آباد: parts 10km apart, but the district itself spans ~39km. Far apart in
    // absolute terms, adjacent relative to its own size.
    expect(planSplit("بخش شریف آباد", multi(square(51.9, 35.5, 0.4), square(52.0, 35.55, 0.35)))).toBeNull();
  });

  it("emits polygons, never a multipolygon, so a piece can never split again", () => {
    const pieces = planSplit("x", multi(square(51.55, 35.75, 0.03), square(51.38, 35.80, 0.02)))!;
    for (const p of pieces) expect(p.geometry.type).toBe("Polygon");
  });

  it("keeps three pieces on the same side distinguishable", () => {
    const pieces = planSplit("y", multi(square(51.6, 35.75, 0.03), square(51.3, 35.75, 0.01), square(51.35, 35.75, 0.01)))!;
    expect(new Set(pieces.map((p) => p.name)).size).toBe(3);
  });
});

describe("directionWord", () => {
  it("picks the axis with the larger separation", () => {
    expect(directionWord([51.4, 35.7], [51.6, 35.71])).toBe("شرق");
    expect(directionWord([51.4, 35.7], [51.2, 35.71])).toBe("غرب");
    expect(directionWord([51.4, 35.7], [51.41, 35.9])).toBe("شمال");
    expect(directionWord([51.4, 35.7], [51.41, 35.5])).toBe("جنوب");
  });
});
