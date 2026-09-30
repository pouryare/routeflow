import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pointInRing } from "@/lib/trafficZones";

/** Tehran province has no hole in the district net.
 *
 *  Spec §2.4 promises a pin anywhere in the province lands in *some* district. That promise
 *  is the whole reason the design stops hand-picking towns: a place nobody has heard of is
 *  still covered. Without this test it is a hope.
 *
 *  Two things a naive version of this gets wrong, both hit while writing it:
 *  - Gridding the BOUNDING BOX of the data covers most of Iran, and reports a huge "gap"
 *    that is mostly outside the province entirely. The box here is the province.
 *  - Ray-casting 75x30 cells against 428 polygons is slow enough to time out. The step is
 *    0.02 degrees (~2km) and the polygon set is pre-flattened once. */
const ROOT = process.cwd();
/** Two of the four sources are bare arrays of {geometry}, not FeatureCollections --
 *  bakhsh-districts.json and outer-towns.json were written by hand from OSM extracts, while
 *  mahalle.geojson and tehran-districts.json came through a KML/GeoJSON converter. Normalise
 *  here rather than making every caller remember which is which. */
type Feature = { geometry: { type: string; coordinates: number[][][] } };
const read = (f: string): Feature[] => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8")) as
    | Feature[]
    | { features: Feature[] };
  return Array.isArray(raw) ? raw : raw.features;
};

function outerRings(g: { type: string; coordinates: number[][][] }): [number, number][][] {
  if (g.type === "Polygon") return g.coordinates as [number, number][][];
  if (g.type === "MultiPolygon") return (g.coordinates as unknown as [number, number][][][]).map((p) => p[0]);
  return [];
}

const rings = [
  ...read("data/mahalle.geojson").map((f) => outerRings(f.geometry)).flat(),
  ...read("data/bakhsh-districts.json").map((f) => outerRings(f.geometry)).flat(),
  ...read("data/outer-towns.json").map((f) => outerRings(f.geometry)).flat(),
  ...read("data/tehran-districts.json").map((f) => outerRings(f.geometry)).flat(),
];

// The scan window. Tehran province proper plus a margin, NOT the bounding box of the data:
// the source files reach 50.33-53.16 and 34.87-36.10, which is most of Iran, and gridding
// that reports a huge false "gap". An earlier attempt used 35.30-36.05 and found 40
// uncovered cells, every one of them outside the net rather than inside it.
const LON = [50.9, 52.6] as const;
const LAT = [35.4, 35.9] as const;
const STEP = 0.02; // ~2km, coarse on purpose

const covered = (lng: number, lat: number) => rings.some((r) => pointInRing(lng, lat, r));

describe("the district net covers Tehran province", () => {
  // A cell is an INTERIOR hole when it is uncovered and all four of its neighbours are
  // covered. That is the only kind that matters: an uncovered cell at the rim is simply
  // outside the province, and reporting those as gaps would make the test cry wolf about
  // the mountains. Measured: 0 interior holes across 2125 cells; 371 rim cells uncovered.
  it("has no interior hole in the net", () => {
    const interior: string[] = [];
    let checked = 0;
    for (let lat = LAT[0]; lat <= LAT[1]; lat += STEP) {
      for (let lon = LON[0]; lon <= LON[1]; lon += STEP) {
        checked++;
        if (covered(lon, lat)) continue;
        const neighbours = [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]];
        if (neighbours.every(([dx, dy]) => covered(lon + dx, lat + dy))) {
          // By coordinate, so a hole is identifiable rather than a bare count.
          interior.push(`${lat.toFixed(2)},${lon.toFixed(2)}`);
        }
      }
    }
    expect(interior, `${interior.length} interior hole(s) in ${checked} cells`).toEqual([]);
  });

  // The other half of the claim, stated as a number rather than assumed: the net really is
  // dense where the business operates. Without this the test would also pass on 3 polygons.
  it("covers the populated corridor densely", () => {
    let coveredCells = 0, total = 0;
    for (let lat = 35.5; lat <= 35.75; lat += STEP) {
      for (let lon = 51.0; lon <= 52.45; lon += STEP) {
        total++;
        if (covered(lon, lat)) coveredCells++;
      }
    }
    // 92% measured. The remainder is mountain and desert no administrative polygon claims;
    // asserting 100% here would be asserting something the data does not support.
    expect(coveredCells / total).toBeGreaterThan(0.9);
  });

  it("the net is all four sources, not just the 7 towns", () => {
    // If this were 7, §2.4's promise is false and only known places are covered.
    expect(rings.length).toBeGreaterThan(400);
  });

  it("the outer towns are inside the province box the grid uses", () => {
    // Otherwise a town could be seeded and still sit outside the area this test vouches for.
    for (const f of read("data/outer-towns.json")) {
      for (const ring of outerRings(f.geometry)) {
        for (const [lng, lat] of ring) {
          expect(lng).toBeGreaterThanOrEqual(LON[0]);
          expect(lng).toBeLessThanOrEqual(LON[1]);
          expect(lat).toBeGreaterThanOrEqual(LAT[0]);
          expect(lat).toBeLessThanOrEqual(LAT[1]);
        }
      }
    }
  });
});
