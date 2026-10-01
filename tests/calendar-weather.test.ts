import { describe, it, expect } from "vitest";
import { conditionsFor, CONDITION_CODES, type ConditionCode } from "@/lib/weather/conditions";
import { ICONS } from "@/components/meridian/icon-map";
import { jalaliToIsoDate, jalaliMonthLength } from "@/lib/jalali";
import {
  monthConditions,
  dayIcon,
  worstCondition,
  CONDITION_ICON,
  CONDITION_LABEL,
  type ForecastRow,
} from "@/lib/weather/calendarForecast";

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
/* The projection only earns its keep if the calendar actually uses it. These pin the
 * SHAPE the grid depends on, which is where a refactor would silently break rendering:
 * keyed by the day-of-month number the grid iterates, with null meaning "clear". */

describe("the day-of-month projection the grid needs", () => {
  /** This is the transform the schedule page performs. Duplicated here on purpose: the
   *  page is a React server component and cannot be imported into a unit test, so the
   *  shape it relies on is pinned here instead. */
  function marksForMonth(jy: number, jm: number, days: number, rows: ForecastRow[]) {
    const byIso = monthConditions(rows);
    const out: Record<number, ReturnType<typeof dayIcon>> = {};
    for (let d = 1; d <= days; d++) {
      out[d] = dayIcon(byIso[jalaliToIsoDate(jy, jm, d)] ?? []);
    }
    return out;
  }

  it("keys by day-of-month as a NUMBER, which is what the grid indexes with", () => {
    const m = marksForMonth(1405, 1, 31, [row("2026-03-21", { precip_mm: 12 })]);
    // 1405/01/01 is 2026-03-21. Object.keys() stringifies, so compare as numbers --
    // and prove the lookup the grid performs works with a NUMBER key, which is the part
    // that would break if the map were ever keyed by ISO date instead.
    expect(Object.keys(m).map(Number)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(m[1]).toBe(CONDITION_ICON.heavy_rain);
    expect(Object.getOwnPropertyNames(m)).toHaveLength(31);
  });

  it("gives every day in the month a key, so a clear day is null and not absent", () => {
    const m = marksForMonth(1405, 1, 31, []);
    expect(Object.keys(m)).toHaveLength(31);
    expect(m[1]).toBeNull();
    expect(m[31]).toBeNull();
  });

  it("a month whose last day is Esfand 29 does not lose that day", () => {
    // 1403 is a Jalali leap year? No - Esfand has 29 days in a common year and 30 in a
    // leap one. Either way the grid asks for `days` and must get `days` keys back.
    for (const jy of [1403, 1404, 1405]) {
      const days = jalaliMonthLength(jy, 12);
      const m = marksForMonth(jy, 12, days, []);
      expect(Object.keys(m)).toHaveLength(days);
    }
  });

  it("survives a day with no forecast row at all, mid-range", () => {
    const m = marksForMonth(1405, 1, 31, [
      row(jalaliToIsoDate(1405, 1, 1), { precip_mm: 12 }),
      row(jalaliToIsoDate(1405, 1, 20), { temp_max: 38 }),
    ]);
    expect(m[1]).toBe(CONDITION_ICON.heavy_rain);
    expect(m[20]).toBe(CONDITION_ICON.extreme_heat);
    expect(m[10]).toBeNull();
    expect(m[31]).toBeNull();
  });

  it("never returns undefined for a day inside the requested range", () => {
    // The grid renders weather[d] directly; an undefined would render as a missing React
    // node rather than as "clear", which is a different thing to a user.
    const m = marksForMonth(1405, 1, 31, [row("garbage"), row("2026-13-45")]);
    for (let d = 1; d <= 31; d++) expect(m[d], `day ${d}`).toBeNull();
  });
});

describe("the cell can be READ, not just seen", () => {
  it("every condition has a Persian label, so no icon ships unnamed", () => {
    for (const code of CONDITION_CODES) {
      expect(CONDITION_LABEL[code], `no label for ${code}`).toBeTruthy();
      // Persian only — an English label in this UI is a copy defect audit-copy would catch.
      expect(/[\u0600-\u06FF]/u.test(CONDITION_LABEL[code]), `${code} label has no Persian`).toBe(true);
    }
  });

  it("labels use Persian letters only — no Arabic or presentation forms", () => {
    for (const [code, label] of Object.entries(CONDITION_LABEL)) {
      expect(/[\u0649\u0643\u064A\u0629]/u.test(label), `${code} has an Arabic letter`).toBe(false);
      expect(/[\uFE70-\uFEFF]/u.test(label), `${code} has a presentation form`).toBe(false);
    }
  });

  it("worstCondition names the same condition the icon came from", () => {
    // The renderer picks the icon from CONDITION_ICON[worst] and the label from
    // CONDITION_LABEL[worst]; if these two ever disagreed the cell would show a sun labelled
    // "fog". This is the assertion that catches it.
    for (const combo of [
      ["heavy_rain", "extreme_heat"],
      ["fog", "dust_storm"],
      ["heavy_rain", "high_wind", "fog"],
      ["snow_ice", "heavy_rain"],
    ] as const) {
      const worst = worstCondition(combo)!;
      expect(dayIcon(combo)).toBe(CONDITION_ICON[worst]);
      expect(CONDITION_LABEL[worst]).toBeTruthy();
    }
  });

  it("worstCondition is null exactly when dayIcon is null", () => {
    for (const combo of [[], ["fog"], ["heavy_rain", "extreme_heat"]] as ConditionCode[][]) {
      expect(worstCondition(combo) === null).toBe(dayIcon(combo) === null);
    }
  });

  it("three conditions sharing the fog glyph still get DIFFERENT labels", () => {
    // This is the whole reason CONDITION_LABEL exists: heavy_rain, dust_storm and fog all
    // render the same glyph, so the glyph alone cannot say which happened.
    expect(CONDITION_ICON.heavy_rain).toBe(CONDITION_ICON.dust_storm);
    expect(CONDITION_ICON.dust_storm).toBe(CONDITION_ICON.fog);
    const labels = [CONDITION_LABEL.heavy_rain, CONDITION_LABEL.dust_storm, CONDITION_LABEL.fog];
    expect(new Set(labels).size, `labels collide: ${labels.join(" / ")}`).toBe(3);
  });
});
