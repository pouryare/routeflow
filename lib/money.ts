/** Money, as whole Toman held in an INTEGER column.
 *
 *  The tables that predate this module store money as `REAL` -- customers.debt_0_7 and
 *  friends, sales.amount. That is tolerable for a map that colours a marker by debt band,
 *  where being a few Rial out changes nothing anyone can see. It is not tolerable for a
 *  system that sums invoices and pays commission from the total: these figures run to
 *  millions of Toman, floating point accumulates error across a few hundred additions,
 *  and the number someone is paid on has to be the number that was agreed.
 *
 *  So every new column is `INTEGER`, suffixed `_toman`, and every value passing through
 *  here is a whole number. The legacy REAL columns are left alone -- they are history
 *  now -- but nothing new reads a float into a money field.
 *
 *  Formatting for display lives in format.ts (`faToman`), which already handles the
 *  grouping and the Persian digits. This module is the input side and the arithmetic.
 */

/** Digits, separators and spaces a Persian keyboard or a paste from Excel can produce.
 *  ٬ is the Persian thousands separator and ٫ the Persian decimal point -- different
 *  codepoints from , and . and invisible as a difference to whoever typed them. */
const PERSIAN_ZERO = 0x06f0;
const ARABIC_INDIC_ZERO = 0x0660;
const GROUPING = /[,٬،\s ‌ ]/g;

/** Reads a human-typed amount into whole Toman, or null if it is not a number at all.
 *
 *  Returns null rather than 0 for unparseable input, because 0 is a real amount and a
 *  silent zero is how a free order gets recorded. The caller decides what an empty box
 *  means. */
export function toToman(input: string): number | null {
  if (typeof input !== "string") return null;

  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) as number;
    if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (ch === "٫") {
      out += ".";
    } else {
      out += ch;
    }
  }

  out = out.replace(GROUPING, "");
  if (!/^-?\d+(\.\d+)?$/.test(out)) return null;

  return roundToman(Number(out));
}

/** Whether a value is safe to put in a `_toman` column. The guard that stops a REAL
 *  creeping in from a division or an average. */
export function isToman(n: number): boolean {
  return Number.isInteger(n);
}

/** The single rounding rule, so a line total and its reversal cannot disagree.
 *
 *  Half away from zero, not JavaScript's Math.round, which rounds -0.5 up to -0 and would
 *  make a reversal 1 Toman off from the sale it reverses. */
export function roundToman(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.sign(n) * Math.round(Math.abs(n));
  return r === 0 ? 0 : r;
}

/** Adds whole Toman, refusing anything fractional.
 *
 *  Throws rather than rounding: a fraction reaching here means a float got into a money
 *  path upstream, and rounding it away would hide the bug at the exact moment it is
 *  cheapest to find. */
export function sumToman(values: number[]): number {
  let total = 0;
  for (const v of values) {
    if (!isToman(v)) {
      throw new TypeError(`مبلغ تومان باید عدد صحیح باشد: ${v}`);
    }
    total += v;
  }
  return total;
}
