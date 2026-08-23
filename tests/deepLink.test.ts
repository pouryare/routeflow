import { describe, expect, it } from "vitest";
import { buildMapLink, formatView, parseIdParam, parseMapLink, parseView } from "@/lib/deepLink";

describe("parseView", () => {
  it("reads a lat,lng,zoom triple", () => {
    expect(parseView("35.72977,51.89126,15")).toEqual({ lat: 35.72977, lng: 51.89126, zoom: 15 });
  });

  it("rejects a triple that is off the globe", () => {
    // Reachable by hand-editing a URL, and setView would silently render nothing.
    expect(parseView("95,51,12")).toBeUndefined();
    expect(parseView("35,200,12")).toBeUndefined();
  });

  it("rejects a zoom the map cannot render", () => {
    expect(parseView("35.7,51.5,0")).toBeUndefined();
    expect(parseView("35.7,51.5,25")).toBeUndefined();
  });

  it("rejects the wrong number of parts, or non-numbers", () => {
    expect(parseView("35.7,51.5")).toBeUndefined();
    expect(parseView("35.7,51.5,12,9")).toBeUndefined();
    expect(parseView("here,there,12")).toBeUndefined();
    expect(parseView(null)).toBeUndefined();
  });
});

describe("formatView", () => {
  it("rounds coordinates to metre precision and the zoom to an integer", () => {
    expect(formatView({ lat: 35.7297681234, lng: 51.8912567, zoom: 14.6 })).toBe("35.72977,51.89126,15");
  });
});

describe("parseMapLink", () => {
  it("reads every parameter", () => {
    expect(parseMapLink("?c=42&d=7&at=35.7,51.5,13&color=distance")).toEqual({
      customerId: 42,
      districtId: 7,
      view: { lat: 35.7, lng: 51.5, zoom: 13 },
      colorMode: "distance",
    });
  });

  it("treats every parameter as independently optional", () => {
    expect(parseMapLink("?c=42")).toEqual({ customerId: 42 });
    expect(parseMapLink("")).toEqual({});
  });

  it("drops a broken parameter instead of failing the whole link", () => {
    // A URL that has been through a chat app and lost a character should still open the
    // map -- just without the part that no longer parses.
    expect(parseMapLink("?c=42&at=nonsense")).toEqual({ customerId: 42 });
    expect(parseMapLink("?c=abc&d=7")).toEqual({ districtId: 7 });
  });

  it("rejects ids that are not positive integers", () => {
    expect(parseMapLink("?c=0")).toEqual({});
    expect(parseMapLink("?c=-3")).toEqual({});
    expect(parseMapLink("?c=1.5")).toEqual({});
  });
});

describe("buildMapLink", () => {
  it("round-trips through parseMapLink", () => {
    const state = {
      customerId: 42,
      districtId: 7,
      view: { lat: 35.7, lng: 51.5, zoom: 13 },
      colorMode: "debt",
    };
    expect(parseMapLink(buildMapLink(state))).toEqual(state);
  });

  it("returns an empty string when there is nothing to say", () => {
    expect(buildMapLink({})).toBe("");
  });

  it("emits parameters in a fixed order, so the same view is always the same string", () => {
    expect(buildMapLink({ colorMode: "debt", customerId: 1 })).toBe("?c=1&color=debt");
  });
});

describe("parseIdParam", () => {
  it("reads the single-id form the other pages use", () => {
    expect(parseIdParam("?f=3", "f")).toBe(3);
    expect(parseIdParam("?l=12&x=1", "l")).toBe(12);
    expect(parseIdParam("?f=oops", "f")).toBeUndefined();
    expect(parseIdParam("", "f")).toBeUndefined();
  });
});
