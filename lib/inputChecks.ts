/** Small shape checks shared by the routes that take dates, quantities and free text.
 *  No imports, so a client component can use them too.
 *
 *  They exist because several write routes accepted anything that parsed as a string or a
 *  number: a cheque due on "zzz", a batch that expires before it was made, a stock adjustment of
 *  1e15 units, a 5,000-character cheque number. Each of those is one typo from a row that breaks
 *  a report. */

const DAY = 86_400_000;

/** `YYYY-MM-DD` (a time suffix is tolerated) that is a real calendar day. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d;
}

/** A real day no further back than `pastDays` and no further ahead than `futureDays` from now. */
export function isDayWithin(value: unknown, pastDays: number, futureDays: number, now = Date.now()): value is string {
  if (!isIsoDay(value)) return false;
  const t = Date.parse(value.slice(0, 10));
  return t >= now - pastDays * DAY && t <= now + futureDays * DAY;
}

/** A parseable timestamp inside the same kind of window. */
export function isTimestampWithin(value: unknown, pastDays: number, futureDays: number, now = Date.now()): value is string {
  if (typeof value !== "string") return false;
  const t = Date.parse(value);
  return !Number.isNaN(t) && t >= now - pastDays * DAY && t <= now + futureDays * DAY;
}

/** A finite quantity with at most `places` decimals and an absolute value up to `max`. */
export function isQuantity(n: unknown, max: number, places = 3): n is number {
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > max) return false;
  const f = 10 ** places;
  return Math.abs(n * f - Math.round(n * f)) < 1e-6;
}

/** Trimmed text of at most `max` characters, or null when it is not text or too long. */
export function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length <= max ? t : null;
}

/** A path segment that is a positive whole-number id ("12", not "abc", "1e3", "-1", "0x1" or "١٢"). */
export function isId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,14}$/.test(value);
}
