import { describe, it, expect } from "vitest";
import { FACILITIES, FACILITY_LABEL, homeBase, mainWarehouse } from "@/lib/facilities";
import { distanceKm } from "@/lib/geo";

// These coordinates were read off the two Google Maps share links the business gave us
// and can't be re-derived from anything else in the repo -- a typo in one of them would
// silently move a depot kilometres away and nothing else would complain. The bounds
// below are wide enough to survive a genuine relocation within the province but tight
// enough to catch a transposed digit or a swapped lat/lng pair.
describe("facilities", () => {
  it("has exactly one home base and one warehouse", () => {
    expect(homeBase()?.kind).toBe("home_base");
    expect(mainWarehouse()?.kind).toBe("warehouse");
    expect(FACILITIES.filter((f) => f.kind === "home_base")).toHaveLength(1);
    expect(FACILITIES.filter((f) => f.kind === "warehouse")).toHaveLength(1);
  });

  it("places every site inside Tehran province", () => {
    for (const f of FACILITIES) {
      expect(f.lat).toBeGreaterThan(35.0);
      expect(f.lat).toBeLessThan(36.5);
      expect(f.lng).toBeGreaterThan(50.5);
      expect(f.lng).toBeLessThan(53.0);
    }
  });

  it("keeps the two sites the distance apart the links put them", () => {
    const km = distanceKm(homeBase()!, mainWarehouse()!);
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(32);
  });

  it("gives every site a unique id and a non-empty name", () => {
    expect(new Set(FACILITIES.map((f) => f.id)).size).toBe(FACILITIES.length);
    for (const f of FACILITIES) expect(f.name.trim().length).toBeGreaterThan(0);
  });

  // The popup prints name and kind label on consecutive lines; a label equal to the
  // name would render the same string twice.
  it("labels each kind by its role, not by a site's name", () => {
    for (const f of FACILITIES) expect(FACILITY_LABEL[f.kind]).not.toBe(f.name);
  });
});
