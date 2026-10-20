/** A real calendar date, not merely a well-shaped string: 2026-02-30 is rejected too.
 *
 *  `Date.parse` alone is NOT this check -- V8 rolls 2026-02-30 over to 2 March and calls it
 *  valid. Round-tripping through `toISOString` is the cheap honest test. */
export function isRealIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
