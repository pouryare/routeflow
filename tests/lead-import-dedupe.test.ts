import { describe, it, expect } from "vitest";
import { decideItem } from "@/lib/leadImport/dedupe";
import type { DuplicatePool } from "@/lib/duplicateDetection";
import type { LocationResolution } from "@/lib/db";

const EXISTING: DuplicatePool[] = [
  { name: "رستوران گلستان", lat: 35.7219, lng: 51.3347, address: "تهران، خیابان ولیعصر", kind: "location", id: 11 },
];

function decide(overrides: Partial<Parameters<typeof decideItem>[0]> = {}) {
  return decideItem({
    name: "کافه لیان",
    address: "تهران، خیابان کریمخان",
    lat: 35.7442,
    lng: 51.4018,
    resolution: "direct",
    pool: EXISTING,
    ...overrides,
  });
}

describe("decideItem -- what gets saved without asking", () => {
  it("auto-adds an exact pin that matches nothing stored", () => {
    expect(decide().verdict).toBe("add");
  });

  it.each<LocationResolution>(["direct", "pluscode", "browser", "manual"])(
    "auto-adds a %s pin",
    (resolution) => {
      expect(decide({ resolution }).verdict).toBe("add");
    }
  );

  // A Nominatim hit is an area match, not a venue. Auto-adding one plants a pin
  // nobody verified, and the user has no signal that it needs distrusting.
  it("refuses to auto-add an approximate Nominatim match", () => {
    expect(decide({ resolution: "nominatim" }).verdict).toBe("unresolved");
  });

  it("refuses anything with no coordinates, whatever the method claimed", () => {
    expect(decide({ lat: null }).verdict).toBe("unresolved");
    expect(decide({ lng: null }).verdict).toBe("unresolved");
  });

  it("flags a near-identical existing location as a duplicate rather than adding it twice", () => {
    const verdict = decide({
      name: "رستوران گلستان",
      address: "تهران، خیابان ولیعصر",
      lat: 35.7219,
      lng: 51.3347,
      resolution: "direct",
    });
    expect(verdict.verdict).toBe("duplicate");
    expect(verdict.duplicateOf).toBe("location");
    expect(verdict.duplicateName).toBe("رستوران گلستان");
  });

  it("reports a duplicate of a customer distinctly from a duplicate location", () => {
    const customerPool: DuplicatePool[] = [
      { name: "کافه لیان", lat: 35.7442, lng: 51.4018, address: null, kind: "customer", id: 22 },
    ];
    const verdict = decide({ pool: customerPool, address: null });
    expect(verdict.verdict).toBe("duplicate");
    expect(verdict.duplicateOf).toBe("customer");
  });

  // A duplicate is worth telling the user about even when the pin is only approximate:
  // "this is one you already have" is more useful than "needs a pin", because the
  // duplicate is the fact that lets them delete the row rather than place it.
  it("still reports a duplicate when the pin itself is only approximate", () => {
    const verdict = decide({
      name: "رستوران گلستان",
      address: "تهران، خیابان ولیعصر",
      lat: 35.7219,
      lng: 51.3347,
      resolution: "nominatim",
    });
    expect(verdict.verdict).toBe("duplicate");
  });

  it("adds a distinct venue that merely shares a district", () => {
    // Same city, far apart: this is a genuinely different place.
    expect(decide().verdict).toBe("add");
  });

  it("carries no duplicate metadata when it is simply being added", () => {
    const verdict = decide();
    expect(verdict.duplicateOf).toBeNull();
    expect(verdict.duplicateName).toBeNull();
  });
});
