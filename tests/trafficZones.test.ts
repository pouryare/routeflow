import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { pointInRing, zoneStatusNow, zonesContaining, type RestrictedWindow } from "@/lib/trafficZones";

// The real rule, as recorded on OSM relation 6947428: permit holders only, Saturday to
// Wednesday 06:30-17:00 and Thursday 06:30-13:00. Free otherwise, and free all Friday.
const TEHRAN: RestrictedWindow[] = [
  { days: [6, 0, 1, 2, 3], from: "06:30", to: "17:00" },
  { days: [4], from: "06:30", to: "13:00" },
];

/** A local-time Date on a known weekday. 2026-08-22 is a Saturday. */
function at(dayOffset: number, hh: number, mm: number): Date {
  const d = new Date(2026, 7, 22, hh, mm, 0);
  d.setDate(d.getDate() + dayOffset);
  return d;
}

describe("zoneStatusNow", () => {
  it("is restricted in the middle of a working morning", () => {
    expect(zoneStatusNow(TEHRAN, at(0, 10, 0))).toEqual({ state: "restricted", until: "17:00" });
  });

  it("is free before the window opens, and says when it opens", () => {
    // The fact worth having at 6am is not "free", it is "free for another half hour".
    expect(zoneStatusNow(TEHRAN, at(0, 6, 0))).toEqual({ state: "free", until: "06:30" });
  });

  it("treats the closing minute as free", () => {
    // The rule is announced as "until 17:00", so 17:00 itself has to be the side you may
    // drive on. The opening minute belongs to the restriction for the same reason.
    expect(zoneStatusNow(TEHRAN, at(0, 17, 0)).state).toBe("free");
    expect(zoneStatusNow(TEHRAN, at(0, 6, 30)).state).toBe("restricted");
  });

  it("uses the shorter Thursday window", () => {
    // Thursday is 2026-08-27, five days after Saturday the 22nd.
    expect(zoneStatusNow(TEHRAN, at(5, 12, 0)).state).toBe("restricted");
    expect(zoneStatusNow(TEHRAN, at(5, 14, 0)).state).toBe("free");
  });

  it("is free all day Friday", () => {
    expect(zoneStatusNow(TEHRAN, at(6, 10, 0))).toEqual({ state: "free", until: null });
  });

  it("says unknown rather than guessing when nobody recorded the hours", () => {
    // The pollution-control zone has no hours in OSM. Claiming it is free would invite a
    // fine; claiming it is restricted would send someone the long way round for nothing.
    expect(zoneStatusNow(null, at(0, 10, 0))).toEqual({ state: "unknown", until: null });
  });
});

describe("pointInRing", () => {
  const square: [number, number][] = [
    [51.0, 35.0],
    [52.0, 35.0],
    [52.0, 36.0],
    [51.0, 36.0],
    [51.0, 35.0],
  ];

  it("finds a point inside and rejects one outside", () => {
    expect(pointInRing(51.5, 35.5, square)).toBe(true);
    expect(pointInRing(50.5, 35.5, square)).toBe(false);
    expect(pointInRing(51.5, 36.5, square)).toBe(false);
  });

  it("handles a concave ring, where a bounding box would not", () => {
    // A C-shape. The notch is inside the box and outside the shape.
    const c: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 3],
      [4, 3],
      [4, 4],
      [0, 4],
      [0, 0],
    ];
    expect(pointInRing(0.5, 2, c)).toBe(true);
    expect(pointInRing(3, 2, c)).toBe(false);
  });
});

describe("the shipped zone file", () => {
  const file = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "public/tehran-traffic-zones.geojson"), "utf8")
  );

  it("carries both zones as closed polygons", () => {
    expect(file.features).toHaveLength(2);
    for (const f of file.features as { geometry: { coordinates: [number, number][][] } }[]) {
      const ring = f.geometry.coordinates[0];
      expect(ring.length).toBeGreaterThan(50);
      // GeoJSON requires the ring to close; Leaflet tolerates an open one, so this would
      // otherwise go unnoticed until something else read the file.
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  it("places real Tehran landmarks on the side of each boundary they are actually on", () => {
    const at = (lng: number, lat: number) =>
      zonesContaining(lng, lat, file.features).map((z) => z.id);

    // Ferdowsi Square is central: inside both rings.
    expect(at(51.4183, 35.7011)).toEqual(["limited_traffic", "low_emission"]);
    // Enghelab Square sits just outside the western edge of the طرح but inside the wider
    // pollution ring -- the case that proves the two boundaries are not the same shape.
    expect(at(51.391, 35.7009)).toEqual(["low_emission"]);
    // Vanak and Tajrish are north of both; Azadi Tower is west of both, which is worth
    // knowing because it is this app's own navigation test point.
    expect(at(51.409, 35.757)).toEqual([]);
    expect(at(51.429, 35.804)).toEqual([]);
    expect(at(51.338097, 35.699739)).toEqual([]);
  });

  it("records hours for the traffic zone and none for the pollution zone", () => {
    const byId = Object.fromEntries(file.features.map((f: { properties: Record<string, unknown> }) => [f.properties.id, f.properties]));
    expect(byId.limited_traffic.restricted).toHaveLength(2);
    expect(byId.low_emission.restricted).toBeNull();
  });
});
