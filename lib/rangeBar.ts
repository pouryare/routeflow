/** The model behind the range bar and the amount slider: sensible steps, reading a range out of the address,
 *  and keeping a pair inside its bounds. Pure, so it is tested without a browser. */

export interface Bounds {
  min: number;
  max: number;
}

/** A step of 1, 2 or 5 times a power of ten that gives about 50 to 100 stops over `span`. */
export function niceStep(span: number): number {
  if (!(span > 0)) return 1;
  const raw = span / 60;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
}

/** A whole number from a query value, or null for anything else (empty, text, negative). */
const wholeOrNull = (v: string | undefined): number | null =>
  v !== undefined && /^\d{1,15}$/.test(v) ? Number(v) : null;

/** `?min=&max=` as a pair inside `bounds`; null when neither is given. A reversed pair is put in order. */
export function parseRange(minParam: string | undefined, maxParam: string | undefined, bounds: Bounds): [number, number] | null {
  const lo = wholeOrNull(minParam);
  const hi = wholeOrNull(maxParam);
  if (lo === null && hi === null) return null;
  const a = Math.min(Math.max(lo ?? bounds.min, bounds.min), bounds.max);
  const b = Math.min(Math.max(hi ?? bounds.max, bounds.min), bounds.max);
  return a <= b ? [a, b] : [b, a];
}

export const inRange = (v: number, range: [number, number] | null): boolean => range === null || (v >= range[0] && v <= range[1]);

/** The bounds of a list of amounts, rounded outward to a step so the thumbs can reach the extremes. */
export function boundsOf(values: number[]): Bounds | null {
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (lo === hi) return null;
  const step = niceStep(hi - lo);
  return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step };
}
