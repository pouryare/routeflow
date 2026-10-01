import { jalaliToIsoDate } from "./jalali";

/** The fixed-in-the-Jalali-calendar public holidays of Iran.
 *
 *  These are the ones no seed has to know: each is a (month, day) pair in the Solar Hijri
 *  calendar, so the ISO date is a pure function of the Jalali year and `lib/jalali.ts`
 *  already converts it correctly, leap years included.
 *
 *  The LUNAR holidays (Eid al-Fitr, Eid al-Adha, Tasua, Ashura, Mawlid) are NOT here and
 *  cannot be. Iran runs three calendars: Solar Hijri for the national one, Gregorian for
 *  international events, and Lunar Hijri for Islamic holidays. A lunar date moves against
 *  the Gregorian one every year and is set by moon sighting, so no offline computation can
 *  know it — those live in the database and an owner confirms them each year. That split
 *  is the whole reason this module exists rather than one table of everything. */

export interface Holiday {
  /** ISO `YYYY-MM-DD`, the form every date in this database is stored as. */
  iso: string;
  jy: number;
  jm: number;
  jd: number;
  title_fa: string;
  /** `official` closes the office; `commemorative` is observed but the office is open —
   *  12 Farvardin, Khordad 15 and Esfand 29 are all commemorative in Iran. */
  kind: "official" | "commemorative";
}

export interface SolarHolidaySeed {
  jm: number;
  jd: number;
  title_fa: string;
  kind: Holiday["kind"];
}

export const SOLAR_HOLIDAYS: readonly SolarHolidaySeed[] = [
  { jm: 1, jd: 1, title_fa: "نوروز", kind: "official" },
  { jm: 1, jd: 2, title_fa: "عید نوروز", kind: "official" },
  { jm: 1, jd: 3, title_fa: "عید نوروز", kind: "official" },
  { jm: 1, jd: 4, title_fa: "عید نوروز", kind: "official" },
  { jm: 1, jd: 12, title_fa: "روز جمهوری اسلامی", kind: "commemorative" },
  { jm: 1, jd: 13, title_fa: "سیزده بدر", kind: "official" },
  { jm: 3, jd: 14, title_fa: "رحلت امام خمینی", kind: "commemorative" },
  { jm: 3, jd: 15, title_fa: "قیام ۱۵ خرداد", kind: "commemorative" },
  { jm: 11, jd: 22, title_fa: "پیروزی انقلاب اسلامی", kind: "official" },
  { jm: 12, jd: 29, title_fa: "ملی شدن صنعت نفت", kind: "commemorative" },
];

/** Every fixed holiday in one Jalali year, in calendar order.
 *
 *  Year-scoped rather than month-scoped so a caller can build a whole-year map once; the
 *  month filter belongs to the calendar's caller, not to this list. */
export function holidaysForJalaliYear(jy: number): Holiday[] {
  return SOLAR_HOLIDAYS.map((h) => ({
    iso: jalaliToIsoDate(jy, h.jm, h.jd),
    jy,
    jm: h.jm,
    jd: h.jd,
    title_fa: h.title_fa,
    kind: h.kind,
  })).sort((a, b) => a.iso.localeCompare(b.iso));
}

/** The holidays that fall inside one Jalali month. */
export function holidaysForJalaliMonth(jy: number, jm: number): Holiday[] {
  return holidaysForJalaliYear(jy).filter((h) => h.jm === jm);
}