import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAV_APP,
  NAV_APPS,
  droppedWaypoints,
  isNavAppId,
  navigateUrl,
  routeIsSingleLeg,
  routeUrl,
} from "@/lib/navApps";

const dest = { lat: 35.685409, lng: 52.017364 };
const origin = { lat: 35.7, lng: 51.4 };

describe("navigateUrl", () => {
  it("builds a Google Maps directions link", () => {
    expect(navigateUrl("google", dest)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=35.685409,52.017364&travelmode=driving"
    );
  });

  it("builds a Waze link that starts navigating rather than just showing the pin", () => {
    expect(navigateUrl("waze", dest)).toBe("https://waze.com/ul?ll=35.685409,52.017364&navigate=yes");
  });

  it("builds a Neshan link that sets a destination rather than only centring the map", () => {
    // The `/@lat,lng,16z` view URL this used to emit opened the app at wherever it was
    // left. The routing path is what makes it go somewhere.
    expect(navigateUrl("neshan", dest)).toBe(
      "https://neshan.org/maps/@35.685409,52.017364,15.3z/routing/destination/35.685409,52.017364"
    );
  });

  it("builds a Balad link", () => {
    expect(navigateUrl("balad", dest)).toBe(
      "https://balad.ir/location?latitude=35.685409&longitude=52.017364&zoom=16"
    );
  });

  it("builds a geo: URI for the system chooser, with the label bracketed", () => {
    expect(navigateUrl("system", dest, "کترینگ من")).toBe(
      "geo:35.685409,52.017364?q=35.685409,52.017364(%DA%A9%D8%AA%D8%B1%DB%8C%D9%86%DA%AF%20%D9%85%D9%86)"
    );
  });

  it("omits the label from a geo: URI when there isn't one", () => {
    expect(navigateUrl("system", dest)).toBe("geo:35.685409,52.017364?q=35.685409,52.017364");
  });

  it("emits every coordinate at six decimals, so no app has to guess at precision", () => {
    const url = navigateUrl("google", { lat: 35.7, lng: 51.4 });
    expect(url).toContain("35.700000,51.400000");
  });
});

describe("routeUrl", () => {
  const stops = [
    { lat: 35.68, lng: 52.01 },
    { lat: 35.69, lng: 52.02 },
    { lat: 35.7, lng: 52.03 },
  ];

  it("puts the whole run in one Google link, last stop as destination", () => {
    // URLSearchParams percent-encodes the separators; Google decodes them, and this is
    // the same shape the app has been emitting all along.
    const url = routeUrl("google", stops, origin) as string;
    expect(url).toContain("destination=35.700000%2C52.030000");
    expect(url).toContain("origin=35.700000%2C51.400000");
    expect(url).toContain("waypoints=35.680000%2C52.010000%7C35.690000%2C52.020000");
  });

  it("omits the origin when there is no position to start from", () => {
    expect(routeUrl("google", stops)).not.toContain("origin=");
  });

  it("falls back to the first stop for apps that cannot carry waypoints", () => {
    // The alternative would be a link that looks like it holds the day and silently
    // holds one stop of it.
    expect(routeUrl("waze", stops)).toBe(navigateUrl("waze", stops[0]));
    expect(routeUrl("neshan", stops)).toBe(navigateUrl("neshan", stops[0]));
  });

  it("returns null for an empty run", () => {
    expect(routeUrl("google", [])).toBeNull();
  });

  it("truncates to Google's 10-waypoint ceiling rather than emitting a link it rejects", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ lat: 35 + i / 1000, lng: 51 + i / 1000 }));
    const url = routeUrl("google", many) as string;
    expect((url.match(/%7C/g) ?? []).length).toBe(9); // 10 waypoints => 9 separators
  });
});

describe("routeIsSingleLeg", () => {
  it("is true only when a multi-stop run is going to an app that can't take one", () => {
    expect(routeIsSingleLeg("waze", 3)).toBe(true);
    expect(routeIsSingleLeg("google", 3)).toBe(false);
    expect(routeIsSingleLeg("waze", 1)).toBe(false);
  });
});

describe("droppedWaypoints", () => {
  it("counts what Google had to leave out", () => {
    expect(droppedWaypoints("google", 12)).toBe(1); // 11 waypoints, 10 allowed
    expect(droppedWaypoints("google", 5)).toBe(0);
  });

  it("is zero for apps that never claimed to carry the run", () => {
    expect(droppedWaypoints("waze", 12)).toBe(0);
  });
});

describe("isNavAppId", () => {
  it("accepts the known ids and rejects anything else", () => {
    for (const a of NAV_APPS) expect(isNavAppId(a.id)).toBe(true);
    expect(isNavAppId("apple")).toBe(false);
    expect(isNavAppId(null)).toBe(false);
  });

  it("has a default that is one of the listed apps", () => {
    expect(isNavAppId(DEFAULT_NAV_APP)).toBe(true);
  });
});
