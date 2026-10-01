/** A percentage the owner typed, as a number.
 *
 * Its own parser because `toToman()` is the WRONG one here, and wrong in a way that
 * would be invisible in the output. `toToman("2.5")` is 3: rounding to whole Toman is
 * exactly right for money and exactly wrong for a rate, so a 2.5% gateway fee becomes
 * 3% and a 0.5% shrinkage allowance becomes 1%. Those are not display artefacts -- they
 * change the suggested price, by enough that the owner stops trusting it.
 *
 * Kept to two decimal places. A rate more precise than that is not a rate anyone is
 * measuring; it is a number typed by accident, and carrying it would put a phantom
 * fraction into the denominator of the forward solve.
 */

const PERSIAN_ZERO = 0x06f0;
const ARABIC_INDIC_ZERO = 0x0660;
/** The Persian thousands separator, plus the Latin and Arabic commas and spaces. */
const GROUPING = /[,٬،\s  ]/g;

/** Reads a typed percentage, or null if it is not a usable one.
 *
 * Null rather than 0 for the empty string, for the reason `toToman` refuses it too: 0
 * is a real answer -- "this product genuinely has no shrinkage" -- and a silent zero is
 * how a free order gets recorded. The caller decides what an absent field means; this
 * function only refuses to guess.
 *
 * Refuses a negative rate and anything above 100. Both refused rather than clamped,
 * because clamping invents a number the owner did not type -- the same failure
 * `validatePlan()` rejects when it finds a gap or an overlap between tiers.
 */
export function toPercent(input: string): number | null {
  if (typeof input !== "string") return null;

  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) as number;
    if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
      out += String(code - PERSIAN_ZERO);
    } else if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (ch === "٫" || ch === ".") {
      out += ".";
    } else {
      out += ch;
    }
  }

  out = out.replace(GROUPING, "").replace(/%/g, "");
  if (out === "" || !/^\d+(\.\d+)?$/.test(out)) return null;

  const n = Number(out);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100) / 100;
}
