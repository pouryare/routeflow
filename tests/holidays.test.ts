import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/* The tmp database is set before lib/db is imported anywhere, exactly as in every other
 * suite here. ROUTEFLOW_DB_PATH is read once at module load. */
const testDbPath = path.join(
  os.tmpdir(),
  `holidays-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
);
process.env.ROUTEFLOW_DB_PATH = testDbPath;

const { getDb } = await import("@/lib/db");
const { upsertHoliday, deleteHoliday, listHolidaysForMonth } = await import("@/lib/repo/holidays");

import { toJalali, jalaliToIsoDate } from "@/lib/jalali";
import {
  SOLAR_HOLIDAYS,
  holidaysForJalaliYear,
  holidaysForJalaliMonth,
} from "@/lib/holidays";
import { tableInfo } from "./helpers/schema";

afterAll(() => {
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(`${testDbPath}${s}`, { force: true });
});

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
/* Eid al-Fitr 2026: the vendored dataset says 2026-03-20 (the day of Eid). The plan's
 * draft test called `listHolidaysForMonth(2026, 1)` — passing a GREGORIAN year where a
 * JALALI one belongs. 2026-03-20 is Jalali 1404/12/29, not 1405/1, so that call would have
 * searched the wrong month and the test would have passed or failed for the wrong reason.
 * Every month argument below is a real Jalali coordinate, derived with `toJalali`. */
const LUNAR_ISO = "2026-03-20";
const LUNAR_J = toJalali(LUNAR_ISO)!; // { jy: 1404, jm: 12, jd: 29 }

/* 2026-03-20 is ALSO a generated holiday: Jalali 1404/12/29 is "ملی شدن صنعت نفت". That
 * makes it a perfect OVERRIDE case and a terrible DELETE case -- deleting it correctly
 * restores the generated row, so asserting "nothing is there" would be asserting a bug.
 * PURE_LUNAR is a date in the same month that nothing generates, which is what the
 * delete-and-stays-gone test needs. */
const PURE_LUNAR_ISO = "2026-03-25"; // Jalali 1405/1/5
const PURE_LUNAR_J = toJalali(PURE_LUNAR_ISO)!;

describe("the holidays table (the lunar ones)", () => {
  it("the plan's date really is a Jalali coordinate we can look up", () => {
    expect(LUNAR_J).toMatchObject({ jy: 1404, jm: 12, jd: 29 });
    expect(jalaliToIsoDate(LUNAR_J.jy, LUNAR_J.jm, LUNAR_J.jd)).toBe(LUNAR_ISO);
  });

  it("stores an owner-confirmed lunar holiday", async () => {
    await upsertHoliday({ iso: LUNAR_ISO, title_fa: "عید فطر", kind: "official", lunar: true });
    expect(
      (await listHolidaysForMonth(LUNAR_J.jy, LUNAR_J.jm)).find((h) => h.iso === LUNAR_ISO),
    ).toMatchObject({ title_fa: "عید فطر", kind: "official" });
  });

  it("is idempotent — the same date twice is one row, last write wins", async () => {
    await upsertHoliday({ iso: LUNAR_ISO, title_fa: "عید فطر", kind: "official", lunar: true });
    await upsertHoliday({ iso: LUNAR_ISO, title_fa: "عید فطر (اصلاح)", kind: "official", lunar: true });
    const rows = (await listHolidaysForMonth(LUNAR_J.jy, LUNAR_J.jm)).filter((h) => h.iso === LUNAR_ISO);
    expect(rows).toHaveLength(1);
    expect(rows[0].title_fa).toBe("عید فطر (اصلاح)");
  });

  it("merges the generated solar holidays in without them ever being seeded", async () => {
    const month = await listHolidaysForMonth(1405, 1);
    expect(month.filter((h) => h.title_fa.includes("نوروز")).length).toBeGreaterThanOrEqual(1);
    for (const h of month) {
      expect(h.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(h.title_fa.length).toBeGreaterThan(0);
    }
    // And the table itself holds none of them: the merge is not a copy.
    const stored = await getDb()
      .prepare("SELECT COUNT(*) AS n FROM holidays WHERE title_fa LIKE '%نوروز%'")
      .get() as { n: number };
    expect(stored.n, "a generated solar holiday was written to the table").toBe(0);
  });

  it("an owner row wins over a generated one on the same date", async () => {
    const generated = holidaysForJalaliMonth(1405, 1).find((h) => h.jd === 12)!;
    await upsertHoliday({
      iso: generated.iso,
      title_fa: "روز جمهوری اسلامی (تعطیل رسمی)",
      kind: "official",
      lunar: false,
    });
    const merged = (await listHolidaysForMonth(1405, 1)).find((h) => h.iso === generated.iso);
    expect(merged?.title_fa).toBe("روز جمهوری اسلامی (تعطیل رسمی)");
    expect(merged?.kind).toBe("official");
    // The override must not change which day it is.
    expect(merged?.jm).toBe(generated.jm);
    expect(merged?.jd).toBe(generated.jd);
  });

  it("deleting an override restores the generated row, not an empty day", async () => {
    const generated = holidaysForJalaliMonth(1405, 1).find((h) => h.jd === 13)!;
    await upsertHoliday({ iso: generated.iso, title_fa: "موقتی", kind: "official", lunar: false });
    await deleteHoliday(generated.iso);
    expect((await listHolidaysForMonth(1405, 1)).find((h) => h.iso === generated.iso)?.title_fa).toBe(
      "سیزده بدر",
    );
  });

  it("deleting a LUNAR row on a generated day RESTORES the generated row", async () => {
    // The collision case, and the reason DELETE means "stop overriding" rather than
    // "erase the holiday". 2026-03-20 is both an Eid and ملی شدن صنعت نفت.
    await upsertHoliday({ iso: LUNAR_ISO, title_fa: "عید فطر", kind: "official", lunar: true });
    await deleteHoliday(LUNAR_ISO);
    expect((await listHolidaysForMonth(LUNAR_J.jy, LUNAR_J.jm)).find((h) => h.iso === LUNAR_ISO)?.title_fa)
      .toBe("ملی شدن صنعت نفت");
  });

  it("deleting a LUNAR row nothing generates really removes it", async () => {
    expect(holidaysForJalaliMonth(PURE_LUNAR_J.jy, PURE_LUNAR_J.jm)
      .some((h) => h.iso === PURE_LUNAR_ISO)).toBe(false);
    await upsertHoliday({ iso: PURE_LUNAR_ISO, title_fa: "عید فطر", kind: "official", lunar: true });
    expect((await listHolidaysForMonth(PURE_LUNAR_J.jy, PURE_LUNAR_J.jm))
      .some((h) => h.iso === PURE_LUNAR_ISO)).toBe(true);
    await deleteHoliday(PURE_LUNAR_ISO);
    expect((await listHolidaysForMonth(PURE_LUNAR_J.jy, PURE_LUNAR_J.jm))
      .find((h) => h.iso === PURE_LUNAR_ISO)).toBeUndefined();
  });

  it("has no organization_id — a national holiday is the same in every tenant", async () => {
    const cols = (await tableInfo("holidays") as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).not.toContain("organization_id");
  });

  it("marks the row as lunar, so the admin screen can say which need confirming", async () => {
    await upsertHoliday({ iso: LUNAR_ISO, title_fa: "عید فطر", kind: "official", lunar: true });
    const row = await getDb().prepare("SELECT is_lunar FROM holidays WHERE iso_date = ?").get(LUNAR_ISO) as {
      is_lunar: number;
    };
    expect(row.is_lunar).toBe(1);
  });

  it("refuses a kind outside the two it knows, at the database", async () => {
    // The CHECK is the last line of defence; a new kind added to the UI without adding it
    // here should fail loudly rather than write a row nothing can render.
    await expect((async () =>
      await getDb()
        .prepare(
          "INSERT INTO holidays (iso_date, title_fa, kind, is_lunar, created_at) VALUES (?,?,?,?,?)",
        )
        .run("2020-01-01", "تست", "invented", 0, new Date().toISOString()))()).rejects.toThrow();
  });

  it("keeps a lunar row's Jalali fields blank — nothing generated it", async () => {
    await upsertHoliday({ iso: PURE_LUNAR_ISO, title_fa: "عید فطر", kind: "official", lunar: true });
    const h = (await listHolidaysForMonth(PURE_LUNAR_J.jy, PURE_LUNAR_J.jm))
      .find((x) => x.iso === PURE_LUNAR_ISO)!;
    // jm/jd are 0 rather than a guess: a caller must not render "month 0" as a date.
    expect(h.jm).toBe(0);
    expect(h.jd).toBe(0);
    expect(h.jy).toBe(0);
  });

  it("the merged month is still in date order after an override", async () => {
    const month = await listHolidaysForMonth(LUNAR_J.jy, LUNAR_J.jm);
    const isos = month.map((h) => h.iso);
    expect(isos).toEqual([...isos].sort((a, b) => a.localeCompare(b)));
  });

  it("a month with neither stored nor generated holidays is empty, not an error", async () => {
    expect(await listHolidaysForMonth(1405, 7)).toEqual([]);
  });
});
