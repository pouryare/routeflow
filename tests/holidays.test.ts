import { describe, it, expect } from "vitest";
import { toJalali, jalaliToIsoDate } from "@/lib/jalali";
import { SOLAR_HOLIDAYS, holidaysForJalaliYear, holidaysForJalaliMonth } from "@/lib/holidays";

/** What the generator must get right.
 *
 *  These are computed rather than seeded because a Jalali year and a Gregorian year are
 *  different lengths: a hard-coded ISO date drifts by a day every four years and is wrong
 *  at every leap boundary. The generated ISO must agree with `toJalali`, the app's own
 *  authority, on ordinary AND leap years. */

describe("the fixed-in-Jalali holidays", () => {
  it("knows a fixed set of holiday dates", () => {
    expect(SOLAR_HOLIDAYS.length).toBeGreaterThanOrEqual(10);
  });

  it("puts Nowruz on 1 Farvardin and Sizdah Bedar on 13 Farvardin", () => {
    expect(SOLAR_HOLIDAYS.find((h) => h.title_fa === "نوروز")).toMatchObject({ jm: 1, jd: 1 });
    expect(SOLAR_HOLIDAYS.find((h) => h.title_fa === "سیزده بدر")).toMatchObject({ jm: 1, jd: 13 });
  });

  it("marks 22 Bahman as the anniversary of the revolution", () => {
    expect(SOLAR_HOLIDAYS).toContainEqual(
      expect.objectContaining({ jm: 11, jd: 22, title_fa: "پیروزی انقلاب اسلامی" }),
    );
  });

  it("distinguishes commemorative days from days the office closes", () => {
    expect(SOLAR_HOLIDAYS.filter((h) => h.kind === "commemorative").length).toBeGreaterThan(0);
  });

  it("round-trips every holiday through the app's own Jalali conversion", () => {
    for (const h of holidaysForJalaliYear(1405)) {
      expect(h.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(toJalali(h.iso)).toMatchObject({ jy: 1405, jm: h.jm, jd: h.jd });
    }
  });

  it("agrees on a LEAP year too — 1403 is a Jalali leap year", () => {
    for (const h of holidaysForJalaliYear(1403)) {
      expect(toJalali(h.iso)).toMatchObject({ jy: 1403, jm: h.jm, jd: h.jd });
    }
  });

  it("returns them in calendar order", () => {
    const list = holidaysForJalaliYear(1405);
    expect(list.map((h) => h.iso)).toEqual(
      [...list].sort((a, b) => a.iso.localeCompare(b.iso)).map((h) => h.iso),
    );
  });
/* The plan tested one ordinary year and one leap year. That is two points on a curve
   * with a boundary every four years, so I widened it -- a generator right in 1403 and
   * 1405 but wrong in 1404 would pass the plan's suite. */

  it("agrees on EVERY Jalali year across a 40-year span, leap included", () => {
    const mismatches: string[] = [];
    for (let jy = 1380; jy <= 1420; jy++) {
      for (const h of holidaysForJalaliYear(jy)) {
        const back = toJalali(h.iso);
        if (!back || back.jy !== jy || back.jm !== h.jm || back.jd !== h.jd) {
          mismatches.push(`${jy}/${h.jm}/${h.jd} -> ${h.iso} -> ${JSON.stringify(back)}`);
        }
      }
    }
    expect(mismatches, `round-trip failures:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("no two generated holidays in a year share an ISO date", () => {
    // Nowruz 1-4 are four separate (jm, jd) pairs; a copy-paste slip making two of them
    // the same day would silently drop a holiday from the calendar with no error anywhere.
    for (let jy = 1400; jy <= 1410; jy++) {
      const isos = holidaysForJalaliYear(jy).map((h) => h.iso);
      expect(new Set(isos).size, `duplicate ISO date in ${jy}`).toBe(isos.length);
    }
  });

  it("holidaysForJalaliMonth is exactly that month of the year", () => {
    for (const jm of [1, 3, 11, 12]) {
      const inMonth = holidaysForJalaliMonth(1405, jm);
      expect(inMonth.length).toBeGreaterThan(0);
      for (const h of inMonth) expect(h.jm).toBe(jm);
      expect(inMonth.map((h) => h.iso)).toEqual(
        holidaysForJalaliYear(1405).filter((h) => h.jm === jm).map((h) => h.iso),
      );
    }
  });

  it("an empty month is an empty list, not a crash", () => {
    expect(holidaysForJalaliMonth(1405, 7)).toEqual([]);
  });

  it("does not mutate SOLAR_HOLIDAYS when generating a year", () => {
    const before = JSON.stringify(SOLAR_HOLIDAYS);
    holidaysForJalaliYear(1405);
    expect(JSON.stringify(SOLAR_HOLIDAYS)).toBe(before);
  });

  it("12 Farvardin, Khordad 15 and Esfand 29 are commemorative, not closures", () => {
    // Observed but the office is OPEN in Iran. Marking them `official` would tell a
    // dispatcher their drivers are off on a working day.
    for (const [jm, jd] of [[1, 12], [3, 15], [12, 29]] as const) {
      expect(
        SOLAR_HOLIDAYS.find((h) => h.jm === jm && h.jd === jd)?.kind,
        `${jm}/${jd} should be commemorative`,
      ).toBe("commemorative");
    }
  });

  it("every generated ISO is a real Gregorian date", () => {
    // Guards against a well-formed but impossible date such as 1405-12-30 in a year that
    // is not leap. toJalali would reject it, but the failure would read as a round-trip
    // bug rather than the bad date it actually is.
    for (const h of holidaysForJalaliYear(1405)) {
      const d = new Date(`${h.iso}T00:00:00Z`);
      expect(Number.isNaN(d.getTime()), `${h.iso} is not a real date`).toBe(false);
      expect(d.toISOString().slice(0, 10)).toBe(h.iso);
    }
  });

  it("uses only Persian letters in titles -- the app's own copy rule", () => {
    const combined = SOLAR_HOLIDAYS.map((h) => h.title_fa).join(" ");
    expect(/[\u0649\u0643\u064A\u0629]/u.test(combined), "an Arabic letter crept in").toBe(false);
    expect(/[\uFE70-\uFEFF]/u.test(combined), "a presentation form crept in").toBe(false);
  });

  it("every holiday carries the year it was generated for", () => {
    for (const h of holidaysForJalaliYear(1403)) expect(h.jy).toBe(1403);
  });

  it("every seed month is within 1..12 and days within 1..31", () => {
    // A typo like jm: 13 would produce a date in the wrong month that still round-trips,
    // because jalaliToIsoDate would happily normalise it. This is the cheaper check.
    for (const h of SOLAR_HOLIDAYS) {
      expect(h.jm, `bad month on ${h.title_fa}`).toBeGreaterThanOrEqual(1);
      expect(h.jm, `bad month on ${h.title_fa}`).toBeLessThanOrEqual(12);
      expect(h.jd, `bad day on ${h.title_fa}`).toBeGreaterThanOrEqual(1);
      expect(h.jd, `bad day on ${h.title_fa}`).toBeLessThanOrEqual(31);
    }
  });

  it("the generator does no arithmetic of its own -- it delegates to jalaliToIsoDate", () => {
    // Not a test of lib/jalali, which has 19 of its own. It pins the ONE assumption the
    // module rests on.
    expect(holidaysForJalaliYear(1405)[0].iso).toBe(jalaliToIsoDate(1405, 1, 1));
    expect(holidaysForJalaliYear(1403)[0].iso).toBe(jalaliToIsoDate(1403, 1, 1));
  });

  it("contains no LUNAR holiday -- those are seeded, and a copy-paste here would be wrong", () => {
    // Eid al-Fitr and Eid al-Adha move against the Gregorian calendar every year. If one
    // ever appears in this list it will be a fixed date that is wrong 11 months a year.
    const titles = SOLAR_HOLIDAYS.map((h) => h.title_fa).join(" ");
    expect(/\u0641\u0637\u0631/u.test(titles), "Eid al-Fitr is lunar; it must not be here").toBe(false);
    expect(/\u0642\u0631\u0628\u0627\u0646/u.test(titles), "Eid al-Adha is lunar").toBe(false);
    expect(/\u0627\u0634\u0648\u0631\u0647/u.test(titles), "Ashura is lunar").toBe(false);
  });
});