import { describe, expect, test } from "vitest";
import {
  gregorianToJalali,
  jalaliToGregorian,
  isJalaliLeap,
  jalaliMonthLength,
  toJalali,
  jalaliToIsoDate,
  faJalaliDate,
  faJalaliDateTime,
  jalaliMonthGrid,
  JALALI_MONTHS,
} from "@/lib/jalali";

/** What Intl says the Persian date is. The whole module exists to agree with this
 *  without calling it, so it is the oracle rather than the implementation.
 *
 *  The formatter is built ONCE, at module scope, and reused.
 *
 *  It was previously constructed inside this function, which meant one per call — and the
 *  caller below calls it 7,672 times, once for every day across 20 Jalali years. Building
 *  an `Intl.DateTimeFormat` is expensive because it loads and negotiates ICU locale data;
 *  measured on this machine it costs ~2.8ms, so the loop spent ~21 seconds constructing
 *  7,672 formatters to do ~0.3 seconds of actual formatting.
 *
 *  That put the test over vitest's 5s default roughly half the time even on an idle
 *  machine — which is why it read as a CPU-contention flake. It was not contention. Hoisting
 *  the formatter makes it ~17x faster (measured 5,859ms -> 343ms), comfortably inside the
 *  budget, and the assertion is unchanged: every one of those days is still checked.
 *
 *  Raising the timeout instead would have hidden a 17x waste rather than removing it. */
const PERSIAN = new Intl.DateTimeFormat("en-u-ca-persian", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "UTC",
});

function intlJalali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  const d = new Date(Date.UTC(gy, gm - 1, gd, 12, 0, 0));
  const parts = PERSIAN.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { jy: get("year"), jm: get("month"), jd: get("day") };
}

describe("gregorianToJalali", () => {
  test("converts a known date", () => {
    expect(gregorianToJalali(2026, 8, 26)).toEqual({ jy: 1405, jm: 6, jd: 4 });
  });

  test("converts Nowruz to the first of Farvardin", () => {
    expect(gregorianToJalali(2026, 3, 21)).toEqual({ jy: 1405, jm: 1, jd: 1 });
  });

  test("agrees with Intl for every day across 20 Jalali years", () => {
    const mismatches: string[] = [];
    const start = Date.UTC(2021, 2, 21); // 1400-01-01
    const end = Date.UTC(2042, 2, 20); // through 1420-12-29
    for (let t = start; t <= end; t += 86400000) {
      const d = new Date(t);
      const gy = d.getUTCFullYear(),
        gm = d.getUTCMonth() + 1,
        gd = d.getUTCDate();
      const ours = gregorianToJalali(gy, gm, gd);
      const theirs = intlJalali(gy, gm, gd);
      if (ours.jy !== theirs.jy || ours.jm !== theirs.jm || ours.jd !== theirs.jd) {
        mismatches.push(
          `${gy}-${gm}-${gd}: ours ${JSON.stringify(ours)} intl ${JSON.stringify(theirs)}`
        );
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});

describe("jalaliToGregorian", () => {
  test("round-trips every day across 20 Jalali years", () => {
    const bad: string[] = [];
    for (let jy = 1400; jy <= 1420; jy++) {
      for (let jm = 1; jm <= 12; jm++) {
        for (let jd = 1; jd <= jalaliMonthLength(jy, jm); jd++) {
          const g = jalaliToGregorian(jy, jm, jd);
          const back = gregorianToJalali(g.gy, g.gm, g.gd);
          if (back.jy !== jy || back.jm !== jm || back.jd !== jd) {
            bad.push(`${jy}/${jm}/${jd} -> ${JSON.stringify(g)} -> ${JSON.stringify(back)}`);
          }
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  test("maps the first of Farvardin to Nowruz", () => {
    expect(jalaliToGregorian(1405, 1, 1)).toEqual({ gy: 2026, gm: 3, gd: 21 });
  });
});

describe("jalaliMonthLength", () => {
  test("first six months have 31 days", () => {
    for (let jm = 1; jm <= 6; jm++) expect(jalaliMonthLength(1405, jm)).toBe(31);
  });

  test("months seven to eleven have 30 days", () => {
    for (let jm = 7; jm <= 11; jm++) expect(jalaliMonthLength(1405, jm)).toBe(30);
  });

  test("Esfand has 30 days in a leap year and 29 otherwise", () => {
    expect(isJalaliLeap(1403)).toBe(true);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(isJalaliLeap(1405)).toBe(false);
    expect(jalaliMonthLength(1405, 12)).toBe(29);
  });
});

describe("toJalali", () => {
  test("reads an instant in Tehran local time, not UTC", () => {
    // 21:00Z is 00:30 the next day in Tehran (UTC+03:30, no DST since 2022).
    expect(toJalali("2026-08-26T21:00:00Z")).toEqual({ jy: 1405, jm: 6, jd: 5 });
    expect(toJalali("2026-08-26T12:00:00Z")).toEqual({ jy: 1405, jm: 6, jd: 4 });
  });

  test("accepts a bare date string as that civil day", () => {
    expect(toJalali("2026-08-26")).toEqual({ jy: 1405, jm: 6, jd: 4 });
  });
});

describe("jalaliToIsoDate", () => {
  test("returns the ISO civil date to store", () => {
    expect(jalaliToIsoDate(1405, 6, 4)).toBe("2026-08-26");
  });

  test("round-trips through toJalali", () => {
    expect(toJalali(jalaliToIsoDate(1403, 12, 30))).toEqual({ jy: 1403, jm: 12, jd: 30 });
  });
});

describe("formatting", () => {
  test("faJalaliDate renders Persian digits, zero padded", () => {
    expect(faJalaliDate("2026-08-26")).toBe("۱۴۰۵/۰۶/۰۴");
  });

  test("faJalaliDateTime appends Tehran wall-clock time", () => {
    expect(faJalaliDateTime("2026-08-26T09:05:00Z")).toBe("۱۴۰۵/۰۶/۰۴ ۱۲:۳۵");
  });

  test("passes through a value that is not a date", () => {
    expect(faJalaliDate("not a date")).toBe("not a date");
  });

  test("month names are the Persian ones", () => {
    expect(JALALI_MONTHS[0]).toBe("فروردین");
    expect(JALALI_MONTHS[11]).toBe("اسفند");
  });
});

describe("jalaliMonthGrid", () => {
  test("starts the week on Saturday", () => {
    const grid = jalaliMonthGrid(1405, 6);
    // 1405/06/01 is 2026-08-23, a Sunday -- one cell after شنبه.
    expect(grid.leadingBlanks).toBe(1);
    expect(grid.days).toHaveLength(31);
  });

  test("pads the first row for a month not starting on Saturday", () => {
    const grid = jalaliMonthGrid(1405, 1); // 1405/01/01 = 2026-03-21, a Saturday
    expect(grid.leadingBlanks).toBe(0);
    const g2 = jalaliMonthGrid(1405, 2); // 1405/02/01 = 2026-04-21, a Tuesday
    expect(g2.leadingBlanks).toBe(3);
  });

  test("each day carries the ISO date it stores as", () => {
    const grid = jalaliMonthGrid(1405, 6);
    expect(grid.days[3]).toEqual({ jd: 4, iso: "2026-08-26" });
  });
});
