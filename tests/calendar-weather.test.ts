import { describe, it, expect } from "vitest";
import { conditionsFor, CONDITION_CODES } from "@/lib/weather/conditions";
import { ICONS } from "@/components/meridian/icon-map";
import { monthConditions, dayIcon, CONDITION_ICON } from "@/lib/weather/calendarForecast";

const row = (
  forecast_date: string,
  o: Partial<Parameters<typeof conditionsFor>[0]> = {},
) => ({
  forecast_date,
  temp_min: null, temp_max: null, precip_prob: null, precip_mm: null, snow_mm: null,
  wind_kmh: null, gust_kmh: null, visibility_m: null, weather_code: null,
  ...o,
});

describe("month weather for the calendar", () => {
  it("returns an empty map for no snapshots rather than throwing", () => {
    expect(monthConditions([])).toEqual({});
  });

  it("classifies a heavy-rain day", () => {
    expect(monthConditions([row("2026-10-01", { precip_mm: 12 })])["2026-10-01"]).toContain(
      "heavy_rain",
    );
  });

  it("keys by the snapshot's OWN forecast_date, never by array order", () => {
    const m = monthConditions([
      row("2026-10-09", { precip_mm: 12 }),
      row("2026-10-02", { snow_mm: 3 }),
    ]);
    expect(m["2026-10-09"]).toContain("heavy_rain");
    expect(m["2026-10-02"]).toContain("snow_ice");
  });

  it("a calm day maps to an empty array, not to a missing key", () => {
    // The cell must know it was CONSIDERED and found clear; an absent key would render
    // identically to "we never fetched", which is a different statement.
    expect(monthConditions([row("2026-10-03")])["2026-10-03"]).toEqual([]);
  });

  it("composes several conditions on one day rather than picking one", () => {
    expect(
      monthConditions([row("2026-10-04", { precip_mm: 12, temp_max: 38 })])["2026-10-04"],
    ).toEqual(expect.arrayContaining(["heavy_rain", "extreme_heat"]));
  });

  it("ignores a row with no usable date instead of writing a key of undefined", () => {
    expect(Object.keys(monthConditions([row("2026-10-05"), row("")]))).toEqual(["2026-10-05"]);
  });

  it("every condition code has an icon, so no cell can render a blank", () => {
    for (const code of ["heavy_rain", "snow_ice", "extreme_heat", "high_wind", "dust_storm", "fog"] as const) {
      expect(CONDITION_ICON[code], `no icon for ${code}`).toBeTruthy();
    }
  });

  it("picks the worst condition's icon when a day has several", () => {
    expect(dayIcon(["heavy_rain", "extreme_heat"])).toBe(CONDITION_ICON.extreme_heat);
  });

  it("an empty condition list has no icon", () => {
    expect(dayIcon([])).toBeNull();
  });

  /* Beyond the plan's nine. */

  it("every icon it names exists in the real ICONS map", () => {
    // The plan claims typing CONDITION_ICON as IconName makes a missing name a compile
    // error. That is only true if the map is exhaustive -- so assert against the actual
    // object, not against the TYPE. A typo that happened to satisfy the type would sail.
    for (const [code, icon] of Object.entries(CONDITION_ICON)) {
      expect(ICONS[icon], `CONDITION_ICON.${code} names "${icon}", absent from ICONS`)
        .toBeTruthy();
    }
  });

  it("the whole CONDITION_CODES enum is covered, so a new code cannot be forgotten", () => {
    expect(Object.keys(CONDITION_ICON).sort()).toEqual([...CONDITION_CODES].sort());
  });

  it("severity order beats the order conditionsFor happened to emit", () => {
    // conditionsFor pushes heavy_rain before extreme_heat; the CELL must show the heat.
    expect(dayIcon(["heavy_rain", "extreme_heat"])).toBe(CONDITION_ICON.extreme_heat);
    expect(dayIcon(["extreme_heat", "heavy_rain"])).toBe(CONDITION_ICON.extreme_heat);
    // Order-independent by construction: same answer either way round.
  });

  it("returns null for a day holding only a condition it does not rank", () => {
    // Defensive: an unknown code from a future enum must not silently pick an icon.
    expect(dayIcon(["not_a_real_condition" as never])).toBeNull();
  });

  it("skips malformed dates: a bare year, a slashed date, and a null", () => {
    const keys = Object.keys(
      monthConditions([
        row("2026-10-05"),
        row("2026"),
        row("2026/10/06"),
        row("2026-13-45"),
        row(null as never),
        row(undefined as never),
      ]),
    );
    // Only the well-formed one survives.
    expect(keys).toEqual(["2026-10-05"]);
  });

  it("accepts a real end-of-month and end-of-year date", () => {
    // The regex must not be so strict it drops 31 December, which every month view has.
    const m = monthConditions([row("2026-12-31", { precip_mm: 9 })]);
    expect(m["2026-12-31"]).toContain("heavy_rain");
  });

  it("does not mutate the rows it is given", () => {
    const rows = [row("2026-10-01", { precip_mm: 12 })];
    const before = JSON.stringify(rows);
    monthConditions(rows);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("a later duplicate for the same date wins, matching the repo's upsert semantics", () => {
    // weather_snapshots is keyed by (lat, lng, date), so duplicates should be impossible.
    // If they ever appear, the LAST one winning is the predictable choice, and the test
    // says so rather than leaving it to whichever key assignment ran last by accident.
    const m = monthConditions([
      row("2026-10-07", { precip_mm: 12 }),
      row("2026-10-07", { temp_max: 38 }),
    ]);
    expect(m["2026-10-07"]).toEqual(["extreme_heat"]);
  });
});