import { describe, expect, it } from "vitest";
import { parseRoute } from "@/lib/osrm";

const ok = {
  code: "Ok",
  routes: [
    {
      distance: 12345.6,
      geometry: {
        coordinates: [
          [51.4, 35.7],
          [51.5, 35.72],
          [51.6, 35.75],
        ],
      },
    },
  ],
};

describe("parseRoute", () => {
  it("reads the geometry back as lat/lng in driving order", () => {
    const route = parseRoute(ok);
    expect(route?.path).toEqual([
      { lat: 35.7, lng: 51.4 },
      { lat: 35.72, lng: 51.5 },
      { lat: 35.75, lng: 51.6 },
    ]);
  });

  it("reports the road distance in kilometres", () => {
    expect(parseRoute(ok)?.km).toBeCloseTo(12.3456, 6);
  });

  it("reports the driving time in whole minutes", () => {
    expect(parseRoute({ ...ok, routes: [{ ...ok.routes[0], duration: 1530 }] })?.minutes).toBe(26);
  });

  it("refuses a refusal delivered as a 200", () => {
    // OSRM answers NoRoute/InvalidQuery with an HTTP 200 and a code in the body, so
    // res.ok is not enough on its own.
    expect(parseRoute({ code: "NoRoute", routes: [] })).toBeNull();
    expect(parseRoute({ code: "Ok", routes: [] })).toBeNull();
  });

  it("refuses geometry it cannot use", () => {
    // One point is not a route to draw a band along, and a non-numeric coordinate would
    // poison every distance computed from it.
    const oneP = { code: "Ok", routes: [{ distance: 1, geometry: { coordinates: [[51.4, 35.7]] } }] };
    const junk = { code: "Ok", routes: [{ distance: 1, geometry: { coordinates: [[51.4, 35.7], ["x", 35.7]] } }] };
    const noDist = { code: "Ok", routes: [{ geometry: { coordinates: [[51.4, 35.7], [51.5, 35.7]] } }] };
    expect(parseRoute(oneP)).toBeNull();
    expect(parseRoute(junk)).toBeNull();
    expect(parseRoute(noDist)).toBeNull();
  });

  it("refuses anything that is not an OSRM answer at all", () => {
    expect(parseRoute(null)).toBeNull();
    expect(parseRoute("<html>502 Bad Gateway</html>")).toBeNull();
    expect(parseRoute({})).toBeNull();
  });
});
