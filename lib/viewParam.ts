/** Reading a `?view=` param, once.
 *
 *  A page selected by a query param needs three things and each is easy to get wrong:
 *  the param may arrive REPEATED (`?view=one&view=all`), in which case Next hands over an
 *  array and `Number([..])` quietly produces NaN; the value may be ABSENT, in which case
 *  the page has a default view; and it may be a value the page does not recognise, in
 *  which case an unguarded switch falls through to a branch that renders nothing.
 *
 *  `journey/page.tsx` hand-rolled the first of these. Four pages are about to read the
 *  param, so it is read once, here, and every page gets all three. */

export type SearchParams = Record<string, string | string[] | undefined>;

/** One value, or undefined. Taking the first beats letting an array surprise you. */
export function one(params: SearchParams, key = "view"): string | undefined {
  const v = params[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

/** One of a known set, or the default. A param is user input, and an unrecognised value
 *  must land on a real view rather than on nothing. */
export function oneOf<const T extends readonly string[]>(
  params: SearchParams,
  allowed: T,
  fallback: T[number],
  key = "view",
): T[number] {
  const v = one(params, key);
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}
