/** Normalising Persian text so that searching for a word finds it.
 *
 *  The same word is routinely stored one way and typed another. Data imported from a
 *  spreadsheet carries whatever the typist's keyboard produced -- very often the Arabic
 *  ي and ك rather than the Persian ی and ک, which are different codepoints that render
 *  almost identically. A phone keyboard emits the Persian pair. So "کترینگ" typed by
 *  hand simply does not match "كترينگ" as stored, and the customer appears not to exist.
 *
 *  The same goes for the zero-width non-joiner inside compounds like «کسب‌وکار», for
 *  the three written forms of alef, and for digits: a customer code shown as ۱۳۰۰۰۲ has
 *  to be findable by typing 130002.
 *
 *  This is a search-and-compare normaliser only. It is deliberately lossy and must never
 *  be used on anything that gets stored or displayed.
 */

const ARABIC_INDIC_ZERO = 0x0660; // ٠..٩
const PERSIAN_ZERO = 0x06f0; // ۰..۹

const CHAR_MAP: Record<string, string> = {
  "ي": "ی", // ARABIC YEH -> FARSI YEH
  "ى": "ی", // ALEF MAKSURA -> FARSI YEH
  "ك": "ک", // ARABIC KAF -> KEHEH
  "ة": "ه", // TEH MARBUTA -> HEH
  "أ": "ا", // ALEF WITH HAMZA ABOVE -> ALEF
  "إ": "ا", // ALEF WITH HAMZA BELOW -> ALEF
  "آ": "ا", // ALEF WITH MADDA -> ALEF
};

/** Zero-width non-joiner and the Arabic short-vowel marks, all invisible and all fatal
 *  to a substring match. */
const STRIPPED = /[‌‍ً-ْـ]/g;

export function normalisePersian(input: string): string {
  let out = "";
  for (const ch of input.replace(STRIPPED, "")) {
    const mapped = CHAR_MAP[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) as number;
    if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
      continue;
    }
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
      continue;
    }
    out += ch;
  }
  return out.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Substring match under normalisation. Empty needle matches everything, which is what
 *  makes an empty search box mean "no filter" rather than "no results". */
export function matchesQuery(haystack: string, needle: string): boolean {
  const q = normalisePersian(needle);
  if (!q) return true;
  return normalisePersian(haystack).includes(q);
}

/** Escapes `%`, `_` and `\` so typed text matches literally in a `LIKE ? ESCAPE '\\'` search. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
