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
    // Nothing ships in this state now that both zones have hours, but the path stays:
    // inventing a schedule for a zone that issues fines is the failure worth guarding.
    expect(zoneStatusNow(null, at(0, 10, 0))).toEqual({ state: "unknown", until: null });
  });
});

describe("the two zones do not share a schedule", () => {
  // The pollution zone runs an hour later than the طرح. Between 17:00 and 18:00 you may
  // drive into the central zone but the outer one is still counting your quota -- which
  // is exactly the hour someone drives home in.
  const POLLUTION: RestrictedWindow[] = [
    { days: [6, 0, 1, 2, 3], from: "06:30", to: "18:00" },
    { days: [4], from: "06:30", to: "13:00" },
  ];

  it("differs in the 17:00-18:00 hour on a working day", () => {
    expect(zoneStatusNow(TEHRAN, at(0, 17, 30)).state).toBe("free");
    expect(zoneStatusNow(POLLUTION, at(0, 17, 30))).toEqual({ state: "restricted", until: "18:00" });
  });

  it("agrees on Thursday afternoon and on Friday", () => {
    expect(zoneStatusNow(TEHRAN, at(5, 14, 0)).state).toBe("free");
    expect(zoneStatusNow(POLLUTION, at(5, 14, 0)).state).toBe("free");
    expect(zoneStatusNow(POLLUTION, at(6, 10, 0))).toEqual({ state: "free", until: null });
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

  it("gives each zone its own hours, its own kind and its own provenance", () => {
    const byId = Object.fromEntries(
      file.features.map((f: { properties: Record<string, unknown> }) => [f.properties.id, f.properties])
    );
    // Permit against quota: one turns you back, the other spends a day of an allowance,
    // and the wording in the panel and on the map follows this field.
    expect(byId.limited_traffic.kind).toBe("permit");
    expect(byId.low_emission.kind).toBe("quota");

    // Same opening minute, different closing hour. Sharing one schedule between them was
    // the obvious shortcut and would be wrong for an hour every working day.
    expect(byId.limited_traffic.restricted[0].to).toBe("17:00");
    expect(byId.low_emission.restricted[0].to).toBe("18:00");
    expect(byId.limited_traffic.restricted[0].from).toBe("06:30");
    expect(byId.low_emission.restricted[0].from).toBe("06:30");

    // The hours came from two different places and the file has to remember which.
    expect(byId.limited_traffic.hours_source).toContain("OSM");
    expect(byId.low_emission.hours_source).not.toContain("OSM relation");

    // Friday is in nobody's window.
    for (const id of ["limited_traffic", "low_emission"]) {
      for (const w of byId[id].restricted) expect(w.days).not.toContain(5);
    }
  });

  it("draws the pollution ring between the expressways it is described by", () => {
    // The published description bounds it by Hemmat to the north, Besat to the south,
    // Imam Ali to the east and Navvab/Chamran to the west. Checking the shipped ring
    // against those is what catches having baked the wrong OSM relation entirely.
    const ring = (file.features as { properties: { id: string }; geometry: { coordinates: [number, number][][] } }[])
      .find((f) => f.properties.id === "low_emission")!
      .geometry.coordinates[0];
    const lats = ring.map((p) => p[1]);
    const lngs = ring.map((p) => p[0]);
    const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(0.01);

    near(Math.max(...lats), 35.756); // بزرگراه همت
    near(Math.min(...lats), 35.646); // بزرگراه بعثت
    near(Math.max(...lngs), 51.484); // بزرگراه امام علی
    near(Math.min(...lngs), 51.379); // نواب / چمران
  });
});
