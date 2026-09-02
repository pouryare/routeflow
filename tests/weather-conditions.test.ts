import { describe, it, expect } from "vitest";
import { conditionsFor } from "@/lib/weather/conditions";

describe("conditionsFor", () => {
  it("flags heavy rain on volume or on probability", () => {
    expect(conditionsFor({ precip_mm: 8 })).toContain("heavy_rain");
    expect(conditionsFor({ precip_prob: 80 })).toContain("heavy_rain");
    expect(conditionsFor({ precip_mm: 3, precip_prob: 40 })).not.toContain("heavy_rain");
  });

  it("flags snow/ice on snowfall or a freezing wet day", () => {
    expect(conditionsFor({ snow_mm: 1 })).toContain("snow_ice");
    expect(conditionsFor({ temp_min: -2, precip_mm: 1 })).toContain("snow_ice");
    expect(conditionsFor({ temp_min: -2, precip_mm: 0 })).not.toContain("snow_ice");
  });

  it("flags extreme heat above 35C", () => {
    expect(conditionsFor({ temp_max: 37 })).toContain("extreme_heat");
    expect(conditionsFor({ temp_max: 34 })).not.toContain("extreme_heat");
  });

  it("flags high wind on gusts over 55", () => {
    expect(conditionsFor({ gust_kmh: 60 })).toContain("high_wind");
    expect(conditionsFor({ gust_kmh: 50 })).not.toContain("high_wind");
  });

  it("flags dust and fog from the WMO code and from visibility", () => {
    expect(conditionsFor({ weather_code: 7 })).toContain("dust_storm");
    expect(conditionsFor({ visibility_m: 500 })).toContain("fog");
    expect(conditionsFor({ weather_code: 45 })).toContain("fog");
  });

  it("returns nothing for a mild day and both codes for a hot windy one", () => {
    expect(conditionsFor({ temp_max: 24, precip_prob: 10, gust_kmh: 15, visibility_m: 12000 })).toEqual([]);
    expect(conditionsFor({ temp_max: 38, gust_kmh: 62 }).sort()).toEqual(["extreme_heat", "high_wind"].sort());
  });
});
