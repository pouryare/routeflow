/** The numbers a phone is asked for -- money, counts, thresholds -- without the OS keyboard.
 *
 *  A phone keyboard for a number is a full QWERTY with a row of digits, pushed up over the field
 *  that is being filled. A keypad of our own keeps the field and the keys in one place, adds the
 *  keys people actually want (000 for money), and offers the likely answers as one-tap chips. */
import { faDigits, faNum } from "@/lib/format";

export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "000" | "." | "⌫";

export const MAX_DIGITS = 12;

/** The value after pressing `key`. The value is a string of digits (and one point, when
 *  `decimal`), never longer than MAX_DIGITS digits, with no leading zeros. Pure. */
export function press(value: string, key: Key, decimal = false): string {
  if (key === "⌫") return value.slice(0, -1);
  if (key === ".") {
    if (!decimal || value.includes(".")) return value;
    return value === "" ? "0." : `${value}.`;
  }
  const digitsIn = (v: string) => v.replace(".", "").length;
  if (key === "000") {
    if (value === "" || value === "0" || value.includes(".")) return value; // 000 is for whole money amounts
    return digitsIn(value) + 3 > MAX_DIGITS ? value : value + "000";
  }
  if (digitsIn(value) >= MAX_DIGITS) return value;
  if (value === "0") return key === "0" ? value : key;
  return value + key;
}

/** How the keypad string reads on screen: Persian digits, the integer part grouped, the
 *  fraction exactly as typed (so "2.0" does not collapse to "2" mid-entry), "۰" when empty. */
export function display(v: string): string {
  if (v === "") return "۰";
  const [int, frac] = v.split(".");
  const head = faNum(Number(int === "" ? "0" : int));
  if (frac === undefined) return head;
  return `${head}٫${faDigits(frac)}`;
}

/** The value of a keypad string as a number; "" and "0." read as the number they show. */
export const valueOf = (v: string): number => (v === "" ? NaN : Number(v));

/** The answers worth one tap: the suggestion itself, then the next round numbers above it
 *  (a customer who owes 1,234,000 usually hands over 1,250,000 or 1,300,000, not 1,234,000).
 *  Ascending, no repeats, nothing for amounts too small to round meaningfully. */
export function quickAmounts(suggested: number): number[] {
  if (!(suggested > 0)) return [];
  const steps = suggested >= 100_000 ? [50_000, 100_000, 500_000] : suggested >= 10_000 ? [5_000, 10_000, 50_000] : suggested >= 1_000 ? [500, 1_000, 5_000] : [];
  const out = new Set<number>([suggested]);
  for (const s of steps) out.add(Math.ceil(suggested / s) * s);
  return [...out].sort((a, b) => a - b);
}

/** Keys from a hardware keyboard (a desk): digits, backspace, the decimal point. Anything else
 *  is not for the keypad. */
export function keyFromEvent(e: { key: string }): Key | "enter" | null {
  if (/^[0-9]$/.test(e.key)) return e.key as Key;
  if (e.key === "Backspace") return "⌫";
  if (e.key === "." || e.key === "٫") return ".";
  if (e.key === "Enter") return "enter";
  return null;
}
