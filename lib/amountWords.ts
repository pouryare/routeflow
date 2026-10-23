/** A whole amount written out in Persian words (F116), for receipts and payment records, where a
 *  figure alone can be misread or altered: ۲٬۵۰۰٬۰۰۰ → «دو میلیون و پانصد هزار».
 *
 *  Written here rather than taken from a library: it is forty lines, the owner chose to keep it
 *  in house, and the rules are the ones used on Iranian cheques -- groups of three joined with
 *  «و», the scale word after each group, and «یک» kept before a scale («یک هزار», «یک میلیون»)
 *  so the words cannot be stretched by adding a figure in front. Fractions are not written:
 *  amounts in this app are whole toman. */

const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", "هزار", "میلیون", "میلیارد", "تریلیون"];

/** 1..999 in words. */
function underThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) parts.push(TENS[t]);
    if (o) parts.push(ONES[o]);
  }
  return parts.join(" و ");
}

/** A whole number in Persian words. Negative amounts get «منفی»; a fraction is rounded first.
 *  Throws past the trillions, which no amount here reaches. */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("not a number");
  let n = Math.round(Math.abs(value));
  if (n === 0) return "صفر";
  if (n >= 1000 ** SCALES.length) throw new RangeError("amount too large to write");
  const groups: string[] = [];
  for (let scale = 0; n > 0; scale += 1, n = Math.floor(n / 1000)) {
    const g = n % 1000;
    if (g) groups.unshift(SCALES[scale] ? `${underThousand(g)} ${SCALES[scale]}` : underThousand(g));
  }
  return `${value < 0 ? "منفی " : ""}${groups.join(" و ")}`;
}

/** «… تومان», the line printed under a figure. */
export function tomanInWords(value: number): string {
  return `${numberToWords(value)} تومان`;
}
