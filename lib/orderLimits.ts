/** Order-entry limits shared by the form and the server. No imports: client components
 *  need these and must not reach lib/db through lib/orders. */

/** Largest quantity a single line may carry. A few stray digits is the realistic failure, and
 *  an unbounded value overflows the money sums downstream. */
export const MAX_PACKS_PER_LINE = 100_000;
export const MAX_LINES_PER_ORDER = 200;
export const MAX_NOTES_LENGTH = 2_000;

/** Reads a typed quantity of packs: Persian/Arabic digits and the Persian decimal point are
 *  understood, and a fraction of a pack is allowed (up to three places) because half cartons
 *  are sold. Returns null for anything that is not a plain positive number in range. */
export function parsePacks(input: string): number | null {
  let out = "";
  for (const ch of input.trim()) {
    const c = ch.codePointAt(0) as number;
    if (c >= 0x06f0 && c <= 0x06f9) out += String(c - 0x06f0);
    else if (c >= 0x0660 && c <= 0x0669) out += String(c - 0x0660);
    else if (ch === "٫" || ch === "،") out += ".";
    else if (ch === "٬" || ch === "," || ch === " ") continue;
    else out += ch;
  }
  if (!/^\d+(\.\d{1,3})?$/.test(out)) return null;
  const n = Number(out);
  return n > 0 && n <= MAX_PACKS_PER_LINE ? n : null;
}

/** Same rule applied to a value that has already been parsed (server side). */
export function isValidPacks(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_PACKS_PER_LINE && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
}
