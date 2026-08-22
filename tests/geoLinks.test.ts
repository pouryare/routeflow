import { describe, it, expect } from "vitest";
import { extractLatLng, extractPlaceAddress, extractPlusCodeCoords, isAllowedLinkHost, isPrivateOrLocalHost } from "@/lib/geoLinks";

describe("extractLatLng", () => {
  it("parses Google's ?q=lat,lng format -- the exact format used in this business's own workbook", () => {
    expect(extractLatLng("https://maps.google.com/maps?q=35.685409,52.017364&ll=35.685409,52.017364&z=16")).toEqual({
      lat: 35.685409,
      lng: 52.017364,
    });
  });

  it("parses Google's /@lat,lng,zoom place-page format", () => {
    expect(extractLatLng("https://www.google.com/maps/place/Somewhere/@35.6892,51.389,17z/data=xyz")).toEqual({
      lat: 35.6892,
      lng: 51.389,
    });
  });

  it("parses a directions ?destination=lat,lng link", () => {
    expect(extractLatLng("https://www.google.com/maps/dir/?api=1&destination=35.6892,51.389")).toEqual({
      lat: 35.6892,
      lng: 51.389,
    });
  });

  it("parses separate lat=/lng= query params in either order", () => {
    expect(extractLatLng("https://example.com/maps?lat=35.6892&lng=51.389")).toEqual({ lat: 35.6892, lng: 51.389 });
    expect(extractLatLng("https://example.com/maps?lon=51.389&lat=35.6892")).toEqual({ lat: 35.6892, lng: 51.389 });
  });

  it("handles a URL-encoded comma in ?q=", () => {
    expect(extractLatLng("https://maps.google.com/?q=35.685409%2C52.017364")).toEqual({
      lat: 35.685409,
      lng: 52.017364,
    });
  });

  it("returns null when no coordinates are present", () => {
    expect(extractLatLng("https://example.com/some/random/path")).toBeNull();
  });

  it("rejects out-of-range values as not real coordinates", () => {
    expect(extractLatLng("https://example.com/?q=200.0,500.0")).toBeNull();
  });
});

describe("extractPlusCodeCoords", () => {
  // Real resolved Google "saved place" URLs (from actual maps.app.goo.gl share links) --
  // the majority shape in practice, carrying a Plus Code instead of an @lat,lng.
  it("decodes a shortened Plus Code embedded in a Google place URL, using the Tehran reference", () => {
    const url =
      "https://www.google.com/maps/place/Tehran,+3rd+Square+Tehranpars,+PGVQ%2B42F+Marina+palace,+Iran/data=!4m2!3m1!1s0x3f8e1d83615e15a3:0xc4a0c76e956261ba!18m1!1e1";
    const coords = extractPlusCodeCoords(url);
    expect(coords).not.toBeNull();
    expect(coords!.lat).toBeCloseTo(35.7428, 3);
    expect(coords!.lng).toBeCloseTo(51.5375, 3);
  });

  it("returns null when the URL has no Plus Code", () => {
    expect(extractPlusCodeCoords("https://www.google.com/maps/place/Fanoos+Hall/data=!4m2")).toBeNull();
  });

  it("returns null for garbage that merely looks like it could contain a code", () => {
    expect(extractPlusCodeCoords("https://example.com/NOTREAL+XX")).toBeNull();
  });
});

describe("extractPlaceAddress", () => {
  it("pulls the readable address/name segment out of a Google place URL", () => {
    const url = "https://www.google.com/maps/place/Fanoos+Hall+%26+Restaurant/data=!4m2!3m1";
    expect(extractPlaceAddress(url)).toBe("Fanoos Hall & Restaurant");
  });

  it("returns null when the URL isn't a /maps/place/ URL", () => {
    expect(extractPlaceAddress("https://maps.app.goo.gl/kt9VH4nCrXUfKkm96")).toBeNull();
  });
});

describe("isAllowedLinkHost", () => {
  it("allows google.com and its subdomains", () => {
    expect(isAllowedLinkHost("google.com")).toBe(true);
    expect(isAllowedLinkHost("maps.google.com")).toBe(true);
    expect(isAllowedLinkHost("www.google.com")).toBe(true);
  });
  it("allows the short-link and Iranian map domains", () => {
    expect(isAllowedLinkHost("goo.gl")).toBe(true);
    expect(isAllowedLinkHost("maps.app.goo.gl")).toBe(true);
    expect(isAllowedLinkHost("neshan.org")).toBe(true);
    expect(isAllowedLinkHost("nshn.ir")).toBe(true);
    expect(isAllowedLinkHost("balad.ir")).toBe(true);
  });
  it("rejects an arbitrary domain -- this is the SSRF guard", () => {
    expect(isAllowedLinkHost("evil.example.com")).toBe(false);
    expect(isAllowedLinkHost("google.com.evil.example.com")).toBe(false);
  });
  it("does not treat a lookalike domain as a subdomain match", () => {
    expect(isAllowedLinkHost("notgoogle.com")).toBe(false);
  });
});

describe("isPrivateOrLocalHost", () => {
  it("flags loopback and localhost", () => {
    expect(isPrivateOrLocalHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrLocalHost("localhost")).toBe(true);
  });
  it("flags RFC1918 private ranges", () => {
    expect(isPrivateOrLocalHost("10.0.0.5")).toBe(true);
    expect(isPrivateOrLocalHost("172.16.0.1")).toBe(true);
    expect(isPrivateOrLocalHost("172.31.255.255")).toBe(true);
    expect(isPrivateOrLocalHost("192.168.1.1")).toBe(true);
  });
  it("flags link-local / cloud metadata (169.254.0.0/16)", () => {
    expect(isPrivateOrLocalHost("169.254.169.254")).toBe(true);
  });
  it("does not flag a normal public IP or hostname", () => {
    expect(isPrivateOrLocalHost("8.8.8.8")).toBe(false);
    expect(isPrivateOrLocalHost("maps.google.com")).toBe(false);
  });
  it("does not false-positive on a public 172.x address outside the private /12", () => {
    expect(isPrivateOrLocalHost("172.15.0.1")).toBe(false);
    expect(isPrivateOrLocalHost("172.32.0.1")).toBe(false);
  });
});
