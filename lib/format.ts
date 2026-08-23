/** Persian-digit number formatting.
 *
 *  Money was already going through toLocaleString("fa-IR") in a couple of dozen places
 *  while every distance went through toFixed(), so a single card could read
 *  «۱۲٬۵۰۰ تومان» directly above «19.4 کیلومتر». These helpers are the one place that
 *  decision lives now, and the reason there is a module for something this small.
 *
 *  Deliberately NOT applied to coordinates. A lat/lng is a value you copy out of this
 *  app and paste into another one; Persian digits would not survive that trip. The same
 *  goes for anything else that is really an identifier rather than a quantity.
 */

const LATIN_TO_FA = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/** Rewrites ASCII digits inside an already-formatted string. For text assembled
 *  elsewhere -- a date, a time, a version -- where re-formatting the number is not an
 *  option because it is no longer a number. */
export function faDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => LATIN_TO_FA[Number(d)]);
}

/** The general case: a quantity, grouped and localised. */
export function faNum(n: number, opts?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fa-IR", opts);
}

/** A quantity shown to a fixed number of decimals -- the toFixed() replacement.
 *  Uses the Persian decimal separator (٫), not a full stop. */
export function faFixed(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("fa-IR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Money. Always whole تومان -- the underlying figures are rials-derived totals where a
 *  fractional تومان is noise, and showing it implies a precision the source lacks. */
export function faToman(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${faNum(Math.round(n))} تومان`;
}

/** A count with its unit, so callers stop hand-assembling `${n.toLocaleString("fa-IR")} روز`. */
export function faCount(n: number, unit: string): string {
  return `${faNum(n)} ${unit}`;
}

/** Gregorian date-time, Persian digits, zero-padded. The app stores ISO timestamps and
 *  shows them back as wall-clock; this only changes the digits, never the calendar. */
export function faDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return faDigits(
    `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** Date only, same rules as faDateTime. */
export function faDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return faDigits(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`);
}
