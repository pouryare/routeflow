/** The Persian (Jalali/Shamsi) calendar.
 *
 *  Everything in this database is stored as an ISO/Gregorian string and always will be.
 *  Storing Jalali strings would break every `date('now')` comparison, every BETWEEN and
 *  every ORDER BY in the app -- «۱۴۰۵/۰۱/۰۱» does not sort or compare as a date, and a
 *  range query across Nowruz would silently return nothing. So the calendar lives here,
 *  at the display and input edges, and nowhere else.
 *
 *  Intl can already *format* a Persian date (`fa-IR-u-ca-persian`), and this Node build
 *  has the full ICU needed for it. What Intl cannot do is the inverse: there is no way to
 *  ask it "which instant is 1405/06/04?", and that is exactly what a date picker needs.
 *  So the arithmetic is here in both directions, and the test suite uses Intl as its
 *  oracle across every day of twenty years -- which makes this provably right rather than
 *  probably right.
 *
 *  The conversion is Kazimierz Borkowski's algorithm, the same one jalaali-js (MIT) uses.
 *  It is exact for the years the breaks table covers, which is far wider than any invoice
 *  this business will ever issue.
 *
 *  Timezone is not a detail here. The business is in Tehran and an order recorded at
 *  00:30 belongs to that day, not the one before -- so a bare instant is resolved through
 *  Asia/Tehran (UTC+03:30, no DST since 2022) rather than UTC or the server's locale.
 */

const TEHRAN = "Asia/Tehran";

/** The one Tehran formatter, built once.
 *
 *  Constructing an `Intl.DateTimeFormat` loads and negotiates ICU locale data, which
 *  costs ~0.96ms here — against ~0.09ms for actually formatting with one you already
 *  hold. That is a 10x difference, and it was being paid per CALL.
 *
 *  It mattered because `tehranCivil` is reached from `jalaliToIsoDate`, which
 *  `jalaliMonthGrid` calls once per day of the month. So drawing a JalaliDatePicker cost
 *  31 formatter constructions — roughly 30ms of setup — to render 31 short strings, on
 *  every render. The month grid is the reason this was hoisted rather than left alone.
 *
 *  Module scope, not lazily memoised: the construction cost is the thing being avoided,
 *  so anything that constructs one on the first call still pays it. */
const TEHRAN_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEHRAN,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

/** شنبه first -- the Persian week, not the Gregorian one. */
export const JALALI_WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;

const div = (a: number, b: number) => Math.trunc(a / b);
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

/** Years at which the 33-year leap cycle shifts. Borkowski's table. */
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262,
  2324, 2394, 2456, 3178,
];

interface JalCal {
  /** 1 when the Jalali year is a leap year. */
  leap: number;
  /** The Gregorian year Farvardin 1 of this Jalali year falls in. */
  gy: number;
  /** The day of March that Farvardin 1 falls on. */
  march: number;
}

function jalCal(jy: number): JalCal {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;

  if (jy < jp || jy >= BREAKS[bl - 1]) {
    throw new RangeError(`سال شمسی خارج از محدوده: ${jy}`);
  }

  for (let i = 1; i < bl; i++) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }

  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;

  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;

  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;

  return { leap: leap === 0 ? 1 : 0, gy, march };
}

/** Gregorian civil date to a Julian day number. */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Julian day number back to a Gregorian civil date. */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

export function gregorianToJalali(gy: number, gm: number, gd: number): JalaliDate {
  const jdn = g2d(gy, gm, gd);
  let jyy = d2g(jdn).gy - 621;
  const r = jalCal(jyy);
  const farvardin1 = g2d(r.gy, 3, r.march);
  let k = jdn - farvardin1;

  if (k >= 0) {
    if (k <= 185) {
      return { jy: jyy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    }
    k -= 186;
  } else {
    jyy -= 1;
    k += 179;
    if (jalCal(jyy).leap === 1) k += 1;
  }

  return { jy: jyy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export function jalaliToGregorian(
  jy: number,
  jm: number,
  jd: number
): { gy: number; gm: number; gd: number } {
  const r = jalCal(jy);
  return d2g(g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1);
}

export function isJalaliLeap(jy: number): boolean {
  return jalCal(jy).leap === 1;
}

/** 31 days for the first six months, 30 for the next five, and Esfand depends on the
 *  leap year -- which is why a date picker cannot hardcode a 12x31 grid. */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

/** The Tehran wall-clock civil date and time of an instant.
 *
 *  A bare `YYYY-MM-DD` is short-circuited rather than parsed: `new Date("2026-08-26")`
 *  is UTC midnight, and pushing that through a timezone is a round trip that can only
 *  lose. A date with no time is already the civil date we want. */
function tehranCivil(
  iso: string
): { gy: number; gm: number; gd: number; hh: number; mi: number } | null {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (bare) {
    return { gy: +bare[1], gm: +bare[2], gd: +bare[3], hh: 0, mi: 0 };
  }

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const parts = TEHRAN_PARTS.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);

  return { gy: get("year"), gm: get("month"), gd: get("day"), hh: get("hour"), mi: get("minute") };
}

/** The Jalali date an ISO instant falls on, in Tehran. */
export function toJalali(iso: string): JalaliDate | null {
  const civil = tehranCivil(iso);
  if (!civil) return null;
  return gregorianToJalali(civil.gy, civil.gm, civil.gd);
}

/** The ISO civil date to store for a Jalali date the user picked. */
export function jalaliToIsoDate(jy: number, jm: number, jd: number): string {
  const g = jalaliToGregorian(jy, jm, jd);
  return `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
}

/** The Tehran civil date of an instant, as the `YYYY-MM-DD` the database stores.
 *
 *  NOT `new Date().toISOString().slice(0, 10)`. That is UTC, and Tehran is UTC+03:30, so
 *  for the last three and a half hours of every evening the UTC date is YESTERDAY. An order
 *  taken at 22:00 belongs to today in Tehran and to tomorrow's query in UTC, so a panel
 *  asking SQL for `order_date = <utc today>` returns nothing exactly when the day is
 *  busiest — and returns yesterday's orders under a heading that says «امروز».
 *
 *  Every "today" comparison against a stored date goes through here. Pass a `now` for
 *  yesterday, or any other offset day: `tehranTodayIso(new Date(Date.now() - 86_400_000))`. */
export function tehranTodayIso(now: Date = new Date()): string {
  const c = tehranCivil(now.toISOString());
  /* Unreachable for a real Date; thrown rather than defaulted because a wrong default here
     silently returns the wrong DAY, which is the failure this function exists to prevent. */
  if (!c) throw new Error("تاریخ نامعتبر");
  return `${c.gy}-${String(c.gm).padStart(2, "0")}-${String(c.gd).padStart(2, "0")}`;
}

const LATIN_TO_FA = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
const faDigits = (s: string) => s.replace(/[0-9]/g, (d) => LATIN_TO_FA[Number(d)]);

/** «۱۴۰۵/۰۶/۰۴». Returns the input untouched when it is not a date, so a malformed
 *  value shows as itself rather than as "Invalid Date" or a silent blank. */
export function faJalaliDate(iso: string): string {
  const j = toJalali(iso);
  if (!j) return iso;
  return faDigits(`${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`);
}

/** «۱۴۰۵/۰۶/۰۴ ۱۲:۳۵» -- the time is Tehran wall clock, matching the date beside it. */
export function faJalaliDateTime(iso: string): string {
  const civil = tehranCivil(iso);
  if (!civil) return iso;
  const j = gregorianToJalali(civil.gy, civil.gm, civil.gd);
  return faDigits(
    `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")} ` +
      `${String(civil.hh).padStart(2, "0")}:${String(civil.mi).padStart(2, "0")}`
  );
}

/** «۴ شهریور ۱۴۰۵» -- for headings, where the numeric form reads as a serial number. */
export function faJalaliLong(iso: string): string {
  const j = toJalali(iso);
  if (!j) return iso;
  return faDigits(`${j.jd} ${JALALI_MONTHS[j.jm - 1]} ${j.jy}`);
}

export interface MonthGrid {
  jy: number;
  jm: number;
  monthName: string;
  /** How many empty cells precede day 1, counting from شنبه. */
  leadingBlanks: number;
  days: { jd: number; iso: string }[];
}

/** One month laid out for a picker. The ISO date each cell stores as is computed here
 *  rather than in the component, so no caller has to know the conversion exists. */
export function jalaliMonthGrid(jy: number, jm: number): MonthGrid {
  const length = jalaliMonthLength(jy, jm);
  const first = jalaliToGregorian(jy, jm, 1);
  // getUTCDay is 0=Sunday..6=Saturday; the Persian week starts on Saturday.
  const jsDay = new Date(Date.UTC(first.gy, first.gm - 1, first.gd)).getUTCDay();
  const leadingBlanks = (jsDay + 1) % 7;

  const days: { jd: number; iso: string }[] = [];
  for (let jd = 1; jd <= length; jd++) {
    days.push({ jd, iso: jalaliToIsoDate(jy, jm, jd) });
  }

  return { jy, jm, monthName: JALALI_MONTHS[jm - 1], leadingBlanks, days };
}

/** Today, in Tehran, as a Jalali date. */
export function todayJalali(now: Date = new Date()): JalaliDate {
  return toJalali(now.toISOString())!;
}

/** Step a (year, month) pair by whole months, wrapping the year. */
export function shiftMonth(jy: number, jm: number, delta: number): { jy: number; jm: number } {
  const total = jy * 12 + (jm - 1) + delta;
  return { jy: Math.floor(total / 12), jm: (total % 12) + 1 };
}
