import { describe, it, expect } from "vitest";
import { cartonNudge } from "@/lib/cartonNudge";

const carton = [{ name: "کارتن", qtyPerPack: 24 }];
describe("carton nudge", () => {
  it("is off at 0 percent", () => expect(cartonNudge({ packs: 20, qtyPerPack: 1 }, carton, 0)).toBeNull());
  it("says what completes the carton when close enough", () => {
    expect(cartonNudge({ packs: 20, qtyPerPack: 1 }, carton, 30)).toEqual({ pack: "کارتن", missingUnits: 4, addPacks: 4 });
  });
  it("stays quiet when far below, or already at or over the pack", () => {
    expect(cartonNudge({ packs: 10, qtyPerPack: 1 }, carton, 30)).toBeNull();
    expect(cartonNudge({ packs: 24, qtyPerPack: 1 }, carton, 30)).toBeNull();
  });
  it("rounds the packs to add up", () => {
    expect(cartonNudge({ packs: 4, qtyPerPack: 5 }, carton, 30)).toEqual({ pack: "کارتن", missingUnits: 4, addPacks: 1 });
  });
  it("picks the nearest bigger pack", () => {
    expect(cartonNudge({ packs: 9, qtyPerPack: 1 }, [{ name: "کارتن", qtyPerPack: 24 }, { name: "بسته", qtyPerPack: 10 }], 20)?.pack).toBe("بسته");
  });
});
